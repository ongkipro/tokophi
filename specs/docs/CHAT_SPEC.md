# TokoΦ — Chat & Ticketing Spec (P1.6 #4)

> Spec for BACKLOG **P1.6 #4** — "Ticketing UI/UX → customer⇄seller chat + merchant chat dashboard".
> Decision-first. Companions: [`CONCEPT.md`](CONCEPT.md) (vision), [`SCHEMA.md`](SCHEMA.md) (tables), [`ARCHITECTURE.md`](ARCHITECTURE.md) (surfaces), [`DEPLOY.md`](DEPLOY.md) (the box we actually run on), ADR 0004/0008/0009.
> Status: **SPEC — not implemented.** No product code exists for any of this yet. Written 2026-07-13.
> Scope note: everything below is grounded in the current tree (support tables = migration `0030`; storefront = Astro SSR, **no shopper auth at all**; public write path = `apps/admin/app/api/public/order`).

---

## 1. Terminology & scope — two axes, two systems

Today there is exactly **one** message system: **support tickets** (`support_tickets` / `support_messages`, migration `0030`), a **merchant ⇄ platform** thread. Merchant side = admin `/bantuan` (`apps/admin/lib/actions/support.ts`); platform side = super-admin `/tiket` (`apps/super-admin/lib/data.ts` + `lib/actions.ts`). Sender is a bare `text` column with values `"merchant" | "platform"`.

P1.6 #4 adds a **second, different axis**: **shopper ⇄ merchant**.

| Axis | Parties | Surfaces | Volume | Identity | Name we use |
|---|---|---|---|---|---|
| **Support ticket** (exists) | merchant ⇄ **us** (platform) | admin `/bantuan` ↔ super-admin `/tiket` | tens/month | both sides are authenticated (`users` / `platform_admins`) | **Tiket** |
| **Conversation** (new) | **shopper** (anonymous) ⇄ merchant | storefront widget ↔ admin `/obrolan` | hundreds–thousands/day at ad scale | shopper is **anonymous**, merchant is a `store_users` row | **Obrolan** |

### DECISION 1 — separate tables, separate UX, shared *thread component*

`support_*` stays as-is (renamed only in copy: "Tiket"). Shopper chat gets **new** tables (`chat_visitors`, `conversations`, `conversation_messages`). We do **not** widen `support_tickets` with a nullable customer party.

Why:
- **Different tenancy shape.** A support ticket is store-scoped but must be readable **across tenants** by super-admin (owner conn, deliberately). A conversation is store-scoped **and** shopper-scoped — a third isolation dimension (`visitor_id`) that only exists on one of the two. One table would need a policy that forks on `kind` anyway.
- **Different identity.** Support has two authenticated parties. Chat has an unauthenticated party with a token, a spam surface, a block-list, and an *upgrade* path to `customers`. None of that belongs on a ticket row.
- **Different lifecycle + volume.** Tickets: `open → answered → closed`, SLA measured in hours, low volume. Conversations: `open → snoozed → closed`, assignment, unread counters, minute-level polling, 100× the rows. Merging forces the hot path (chat polling) to share indexes with the cold path.
- **Cost of separation is small** because the *UI* is shared: one `<Thread>` component (bubble list + composer + status chip) is factored out and used by all four screens (`/bantuan`, `/tiket`, `/obrolan`, storefront widget renders the same shape in vanilla).

Non-goals for v1: group chat, typing indicators, presence, voice notes, WhatsApp bridging (CRM already does wa.me hand-off), shopper login.

---

## 2. Schema

New tables (migration **`0036`** — `0035` (support RLS retrofit) is the current head; SCHEMA.md count 57 → **60**). Conventions per `SCHEMA.md`: `snake_case`, `uuid` PKs, `timestamptz`, store-scoped + RLS. **No money columns here** — chat carries no monetary value; an order link is a FK and the admin renders totals via the existing `IDR()`.

```
chat_visitor_status : enum('active','blocked')
conversation_status : enum('open','snoozed','closed')
message_sender      : enum('customer','merchant','system')

chat_visitors(
  id            uuid pk default gen_random_uuid(),   -- the token subject (`vid`)
  store_id      uuid not null → stores(id),
  customer_id   uuid null → customers(id),           -- set on identity upgrade (§3)
  name          text null,                           -- what the shopper typed ("Nama")
  phone         text null,
  status        chat_visitor_status not null default 'active',
  ip_hash       text null,                           -- sha256(ip + AUTH_SECRET) — abuse only, not raw PII
  user_agent    text null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
)
index chat_visitors_store_customer_idx on (store_id, customer_id)

conversations(
  id                 uuid pk,
  store_id           uuid not null → stores(id),
  visitor_id         uuid not null → chat_visitors(id),
  customer_id        uuid null → customers(id),      -- denormalized on upgrade (fast inbox join)
  order_id           uuid null → orders(id),         -- "tanya soal pesanan #…"
  status             conversation_status not null default 'open',
  assigned_user_id   uuid null → users(id),          -- staff assignment (Ditugaskan)
  unread_merchant    integer not null default 0,     -- counters, not a scan
  unread_visitor     integer not null default 0,
  last_message_at    timestamptz not null default now(),
  last_message_body  text null,                      -- inbox preview (truncated to 140 chars on write)
  entry_url          text null,                      -- page the widget was opened on
  product_handle     text null,                      -- if opened from /produk/[handle]
  created_at         timestamptz not null default now()
)
index conversations_store_last_msg_idx  on (store_id, last_message_at desc)
index conversations_store_status_idx    on (store_id, status, last_message_at desc)
index conversations_store_visitor_idx   on (store_id, visitor_id)

conversation_messages(
  id               uuid pk,
  conversation_id  uuid not null → conversations(id) on delete cascade,
  store_id         uuid not null → stores(id),       -- DENORMALIZED on purpose: RLS policies key on store_id
  sender           message_sender not null,          -- customer | merchant | system
  sender_user_id   uuid null → users(id),            -- which staff replied (null for customer/system)
  body             text not null,                    -- ≤ 2000 chars (checked in the action, not a CHECK)
  read_at          timestamptz null,                 -- when the OTHER side read it
  created_at       timestamptz not null default now()
)
index conversation_messages_conv_created_idx on (conversation_id, created_at, id)
```

Notes for the implementer:
- **`conversation_messages.store_id` is denormalized deliberately.** Every RLS policy in `0012` is `store_id = app_current_store_id()`; a join-based policy would be slower and inconsistent with the other 32 tables. `support_messages` got this wrong (no `store_id`, no RLS) — don't repeat it.
- The cursor for polling is `(created_at, id)`; `id` breaks ties so a fast merchant reply can't be skipped.
- `unread_*` counters are maintained in the same txn as the insert (`+1` for the receiving side, reset to `0` when that side reads). Cheap, and the inbox badge is one `sum()` — no `EXISTS` scan per row.

### DECISION 2 — retrofit RLS onto `support_*` in the same migration

`support_tickets` / `support_messages` were added in `0030`, **after** the RLS migration `0012`, and **no RLS was ever enabled on them**. `apps/admin/lib/actions/support.ts` uses the bare owner `db` with a manual `eq(storeId, session.storeId)` filter — correct today, but it is the only merchant-facing data path in the app that is not behind `withCurrentTenant`/`withTenant`, i.e. one forgotten `where` from a cross-tenant leak. ~~Migration `0035` therefore also~~ **✅ ALREADY FIXED (2026-07-13, migration `0035`)** — the retrofit below shipped ahead of chat; kept for context. It also:
1. adds `support_messages.store_id` (backfilled from its ticket) — `alter table … add column … ; update … from support_tickets ; set not null`,
2. `enable row level security` + the standard `tenant_isolation` policy on both tables,
3. and slice 6 rewrites `lib/actions/support.ts` onto `withCurrentTenant`/`withTenant`.

Store-scoped tables with RLS: **32 → 37** (`chat_visitors`, `conversations`, `conversation_messages`, `support_tickets`, `support_messages`). Update `verify-rls` / `verify-rls-app` table lists and `SCHEMA.md`.

Seed (`packages/db/src/seed.ts`, deterministic per CLAUDE.md — anchored to `TODAY`, no `Math.random()`): 3 visitors, 4 conversations (1 unread/open from an anonymous visitor, 1 assigned + answered, 1 tied to a real order + customer, 1 closed), ~4 messages each.

---

## 3. Anonymous shopper identity

The storefront has **zero** customer auth today: `src/pages/akun.astro` is a dead demo form (`onsubmit` → "Demo — sistem akun aktif setelah backend terhubung"), the cart is `localStorage`, and checkout POSTs to the admin's `/api/public/order` which upserts a `customers` row by email. There is no session, no cookie, no `customer_users` table. So chat identity must be built from nothing — and must **not** require login (asking an Indonesian shopper to register before asking "ready kak?" kills the feature).

### DECISION 3 — signed visitor token in a first-party httpOnly cookie, set by the storefront

- On the shopper's **first message** (not on page load — no row for bots that never type), the storefront API creates a `chat_visitors` row and sets cookie **`tokophi_chat`** = a **jose JWT** `{ vid, sid, iat }`, `aud: "chat-visitor"`, signed with `AUTH_SECRET` (already shared across containers), **httpOnly · SameSite=Lax · Secure · Path=/ · Max-Age=180 days**.
- httpOnly ⇒ **no localStorage mirror** — the widget never needs to read the id, only the server does. This kills the XSS-token-theft surface.
- The cookie is **first-party** because the API lives on the storefront's own origin (§4). This is why we do not host the chat API on `app.tokophi.com`: `toko.tokophi.com → app.tokophi.com` is cross-site, and merchant **custom domains** (P1.6 #3) make it worse — a third-party cookie that Safari ITP and Chrome will drop. The existing `/api/public/*` endpoints get away with `Access-Control-Allow-Origin: *` precisely *because* they are stateless and carry no identity.
- Losing the cookie (new device, cleared browser) = a **new visitor**. Accepted for v1: chat history is not a promise we make to anonymous shoppers. Cross-device recovery is an open question (§8 Q5).

**Upgrade path to a real customer:**
1. The widget asks for **Nama** (required, ≤60 chars) and optionally **No. WhatsApp** before the first message — one tiny form, not a login. Stored on `chat_visitors.name/phone`.
2. On **checkout**, `checkout.astro` sends the current `vid` (server-rendered into the page from the cookie) in the `/api/public/order` payload. The order route, which already upserts a `customers` row, additionally sets `chat_visitors.customer_id` + backfills `conversations.customer_id`/`order_id` for that visitor's open conversation. The merchant then sees "Rina · Pelanggan · Pesanan #1042" instead of "Tamu".
3. If a shopper types an email/phone matching an existing `customers` row, we **do not** auto-link (an anonymous visitor claiming an existing customer identity is an impersonation vector). Linking happens only via the checkout path (which proves possession of the order) or a manual merchant action in the inbox ("Tautkan ke pelanggan").

**Abuse surface & mitigations** (a public, unauthenticated write endpoint — treat it like `/api/public/order`):
- Per-IP + per-visitor fixed-window limits via the existing `rateLimit()` (`@tokophi/lib/cache`) / `rateLimited()` helper pattern: **1 new conversation / 10 min / IP**, **5 messages / min / visitor**, **60 messages / hour / visitor**, **20 messages / min / IP**.
- `body` ≤ 2000 chars; **no attachments in v1** (removes the malware/storage abuse surface entirely — the biggest single win).
- `chat_visitors.status='blocked'` — merchant action; blocked visitors get `403` on send and their existing thread is hidden from the inbox default filter.
- `ip_hash` = `sha256(ip + AUTH_SECRET)`, never the raw IP (PII minimization; we already extract the IP correctly in `clientIp()`, Cloudflare-aware).
- ⚠️ `rateLimit()` is **in-process memory** — fine on one box (Coolify, one container per surface) but it resets on redeploy and doesn't span containers. Prod hardening = a Cloudflare Rate Limiting rule on `/api/chat/*` (the same note `public-guard.ts` already carries). Cloudflare **Turnstile** on the "start conversation" step is the next lever if we get botted (§8 Q9).
- Max **3 open conversations per visitor** — the 4th send appends to the newest instead of creating a row.

---

## 4. Transport

### DECISION 4 — **short polling with a cursor** for v1. Not SSE, not WebSocket.

Where the endpoints live: **shopper-side chat API = Astro SSR API routes in the storefront** (`apps/storefront/src/pages/api/chat/*.ts`), same-origin; **merchant-side = Next server actions** in the admin (`lib/actions/chat.ts`) plus one thin polling route (`app/api/chat/poll/route.ts`, session-guarded — server actions are POST-only RPC and are a poor fit for a 5s GET poll).

Endpoints (shopper, same-origin, no CORS):
```
POST /api/chat/send   { body, name?, phone?, entryUrl?, productHandle? }
                      → creates visitor+cookie+conversation on first call; returns { conversationId, message }
GET  /api/chat/poll?since=<iso>,<uuid>
                      → { messages: [...], status, unread } — messages strictly after the cursor
POST /api/chat/read   → clears unread_visitor
```
Merchant: `GET /api/chat/poll?since=…` (inbox delta + unread totals) + server actions `sendReply`, `setStatus`, `assign`, `blockVisitor`, `linkCustomer`.

Cadence: widget **3s** while the panel is open and the tab is focused, **15s** when the panel is closed or the tab is hidden (`visibilitychange`), **stop** after 5 min idle with the panel closed. Inbox **5s** focused, **30s** blurred. Empty deltas return `{messages:[]}` (~200 bytes) — a poll is one indexed query on `(conversation_id, created_at, id)`.

Why polling, concretely on **our** infra:
- **One box** (Vultr 4 vCPU / 8GB, Coolify + Traefik + Postgres, `DEPLOY.md`). At the planned scale (50–100 stores, 10–30k visitors/day, of which chat-openers are a small fraction) polling is a few queries/second — noise next to the catalog SSR we already do.
- **SSE would not actually save work.** We have no pub/sub. An SSE stream still needs a source of change events: either (a) it polls Postgres per connection (strictly worse — same queries plus a held connection), or (b) we build a `LISTEN/NOTIFY` listener with a dedicated connection + in-process fan-out per container. (b) is real infrastructure for a feature with zero users today.
- **Cloudflare (proxied, orange cloud) + Traefik buffer/ time out long-lived connections** and CF's ~100s idle limit means heartbeats and reconnect logic. `DEPLOY.md` gotcha #11 already shows how much prod-only subdomain/proxy weirdness we pay for; long-lived streams add a new class of it (Coolify's own realtime is why 6001/6002 are open in UFW — that's *its* soketi, not something we can borrow).
- **WebSockets** additionally want sticky sessions and a second process — flatly not worth it before we have chat traffic.

**Upgrade path (designed in now, not later):** the poll response is a **cursor-based delta**, exactly the payload an SSE `message` event would carry. Upgrading = add `GET /api/chat/stream` (same auth, same payload, `text/event-stream`, 25s heartbeat comment) backed by **one** `LISTEN chat_<store_id>` connection per container fanning out in-process; the client falls back to polling on `EventSource` error. No schema, no payload, no UI change. WebSocket only if we ever add typing/presence. Trigger to do it: sustained >20 concurrent open widgets per store, or a product requirement for sub-second delivery.

---

## 5. Surfaces

### 5a. Storefront chat widget (`apps/storefront`)
- **Plain Astro + vanilla `<script>`, no React.** The storefront has no framework island today (the `Header.astro` dropdown is vanilla). Do not pull React/Base UI into it for a bubble — it would double the JS budget of an SEO-first, ad-landing storefront.
- Files: `src/components/Chat.astro` (bubble + panel + composer + script), mounted once in `src/layouts/Layout.astro` so it is on every page. Styles use the storefront's own tokens (`brand-*`, `ink`, `line`, `cream`, `muted`) — **not** the admin's shadcn tokens.
- Content: header "Tanya {STORE.name}" + a "biasanya balas < 1 jam" line; first-run form (Nama + optional WhatsApp); bubble list (shopper right / merchant left, mirroring the existing `thread-client.tsx` treatment); textarea + Kirim; unread dot on the bubble.
- Context: on `/produk/[handle]` prefill a chip "Tanya tentang produk ini" → sends `productHandle` so the merchant sees the product in the thread header. On `/checkout/sukses` prefill the order number.
- Fallback: `STORE.whatsapp` already exists in `catalog.ts` — outside business hours (§8 Q2) show "Balas via WhatsApp" alongside. Do not remove the WA path; Indonesian shoppers expect it.
- SSR/CSR: the widget renders empty markup server-side and hydrates from `/api/chat/poll` on open. Timestamps are formatted **client-side only** (`id-ID`) — per the determinism rule, never render `Date.now()`-derived text during SSR.

### 5b. Merchant chat inbox — admin `/obrolan` (new)
- Nav: new item **Obrolan** (icon `MessagesSquare`) in `lib/nav.ts`, in the same group as Pesanan/Pelanggan, with an **unread badge** (sum of `unread_merchant`). The badge is the "unified app" hook from the vision — dashboard + chat in one shell.
- Layout: 3-pane on desktop, stacked on mobile.
  - **List** — filter tabs `Semua · Belum dibaca · Ditugaskan ke saya · Ditunda · Selesai` (counts per tab, same shape as super-admin `/tiket`'s tabs). Row = avatar/initial, name-or-"Tamu", preview (`last_message_body`), relative time, unread dot, assignee chip.
  - **Thread** — the shared `<Thread>` component; composer with Kirim; status control; assignment control.
  - **Context sidebar** — visitor → customer (name/phone, "Tautkan ke pelanggan"), last order (link to `/pesanan/[id]`), the product they were looking at (`product_handle` → `ProductThumb`), entry URL, "Blokir" action.
- Dashboard card: "Obrolan belum dibaca — N" linking to `/obrolan` (the unified-app feel; reuses `KpiCard`).
- Polling: 5s focused / 30s blurred, `router.refresh()`-free (fetch the delta, patch state) so we don't re-render the whole RSC tree every 5s.

### 5c. Ticketing polish (`/bantuan` ↔ `/tiket`)
Both screens are functional but thin. Polish, in the same slice, by **reusing** what chat builds:
- Extract `<Thread>` + `<Composer>` + `<StatusChip>` into shared components; `/bantuan/[id]`, `/tiket/[id]` and `/obrolan` all use them (today `thread-client.tsx` is duplicated near-verbatim in admin and super-admin).
- **Unread**: add `unread_merchant`/`unread_platform` to `support_tickets` (same counter pattern) → a badge on the `/bantuan` nav item and on super-admin `/tiket`. Today "answered" is the only signal and nothing tells the merchant a reply landed.
- **Assignment**: `support_tickets.assigned_admin_id → platform_admins` + an assignee picker on `/tiket` (super-admin already has `platform_admins` + `requirePlatformAdmin()`).
- **Filters/tabs on `/bantuan`** (Semua/Menunggu/Dibalas/Selesai) mirroring `/tiket`.
- **Capability gate**: `lib/actions/support.ts` currently only checks `getSession()` — no `requireCapability`. Add `support:write` and gate `createTicket`/`replyTicket`/`closeTicket`, and move both reads and writes onto `withCurrentTenant`/`withTenant` (see DECISION 2).
- **Bug to fix while in there**: `bantuan-client.tsx`'s `ago()` calls `Date.now()` during render → SSR/client mismatch risk (CLAUDE.md determinism rule). Move relative-time formatting into `useEffect`/a client-only `<TimeAgo>`.

### ⚠️ Base UI constraints that will bite the implementer (admin/super-admin only)
Per CLAUDE.md — shadcn here runs on **Base UI, not Radix**:
- **Do NOT use `Select`** for the assignee picker or the status picker. Use `DropdownMenu` (or `Tabs` for the filter row).
- Triggers take **`render={<Button …/>}`**, never `asChild`.
- A `Button` rendered as a `Link` needs **`nativeButton={false}`** (thread rows link to `/pesanan/[id]`, `/pelanggan/[id]` — this will hit you).
- `DropdownMenuLabel` is patched to a plain `<div>` — keep it; `Menu.GroupLabel` needs a `<Menu.Group>` parent.
- `Switch`/`Checkbox` use `onCheckedChange`, `Tabs` uses `onValueChange`.
- Toasts via `sonner` (`<Toaster>` is already mounted in the admin layout).
- **None of this applies to the storefront widget** — it is vanilla, and must stay that way.

---

## 6. Security

**RLS.** `chat_visitors`, `conversations`, `conversation_messages` all carry `store_id` and get the standard `tenant_isolation` policy (`store_id = app_current_store_id()`), plus the `support_*` retrofit (DECISION 2). Admin chat reads go through `withCurrentTenant`, writes through `withTenant(storeId, …)` — **never** the bare module-level `db` (that runs as owner and bypasses RLS).

**The storefront chat API is an owner-connection exception**, exactly like `apps/admin/app/api/public/order/route.ts` (an anonymous shopper has no session and therefore no GUC to set). That makes the *application* the isolation boundary for shopper reads, so the rules are non-negotiable:
1. Every query filters on **both** `store_id = STORE_ID` **and** `visitor_id = token.vid`.
2. A conversation id from the client is **never** trusted as a lookup key on its own — it is validated against `(store_id, visitor_id)` first, or (better) the server resolves the conversation *from the token* and ignores any client-supplied id.
3. Messages are returned only for the conversation resolved that way ⇒ a shopper structurally cannot read another shopper's thread, another store's thread, or the merchant's inbox.
4. The endpoint returns only `{sender, body, created_at}` — never `sender_user_id`, `ip_hash`, `assigned_user_id`, or any staff name beyond a display label ("Tim {STORE.name}").
5. `system` messages are server-generated only; `sender` is **never** taken from the request body.

**RBAC.** New capabilities in `lib/rbac-policy.ts` (client-safe matrix) + `requireCapability()` on every mutating action:

| Capability | Meaning | owner | admin | staff | gudang |
|---|---|---|---|---|---|
| `chat:read` | see `/obrolan`, read threads | ✅ | ✅ | ✅ | ❌ |
| `chat:write` | reply to a shopper | ✅ | ✅ | ✅ | ❌ |
| `chat:manage` | assign, close/snooze, block visitor, link customer | ✅ | ✅ | ❌ | ❌ |
| `support:write` | create/reply/close a **platform** ticket | ✅ | ✅ | ❌ | ❌ |

UI gating via `useCan()` / `<Can capability="chat:manage">` exactly as the other editors do. `chat:read` is the first *read* capability — the nav item and the route must both check it (add a guard in the page, not just the sidebar).

**Rate limiting / abuse.** As §3. Both the send endpoint (per-IP + per-visitor) and the admin poll (per-session, generous) go through `rateLimit()`. Prod: a Cloudflare rule in front of `/api/chat/*`.

**PII.** Store `name`/`phone` only if the shopper typed them; hash IPs; no message-body logging; add chat rows to any future retention/purge job (§8 Q7).

---

## 7. Implementation slices

Ordered, each independently shippable and verifiable. Sizes are rough sessions (S ≈ half day, M ≈ 1 day, L ≈ 2 days).

| # | Slice | Deliverable | Size |
|---|---|---|---|
| **1** | **Schema + RLS + seed** | migration `0036` (3 new tables + enums + indexes; `support_messages.store_id` backfill; RLS on all 5); `packages/db/src/schema.ts`; deterministic seed (3 visitors / 4 conversations); update `verify-rls`+`verify-rls-app` table lists; `SCHEMA.md`+`DATA_MODEL.md` (57→60 tables). **Green `npm run verify-rls-app`.** | **M** |
| **2** | **Storefront widget + chat API** | `src/pages/api/chat/{send,poll,read}.ts` (owner conn + explicit `store_id`, visitor JWT cookie, rate limits); `src/components/Chat.astro` mounted in `Layout.astro`; product/order context; WA fallback. Verify: two browsers → messages land in the DB, thread isolation holds. | **L** |
| **3** | **Admin `/obrolan` inbox (read + reply)** | `lib/data/chat.ts` (`withCurrentTenant`), `lib/actions/chat.ts` (`withTenant` + `requireCapability`), caps `chat:read`/`chat:write` in `rbac-policy.ts`, 3-pane screen, `/api/chat/poll` (session-guarded), nav entry + unread badge, shared `<Thread>` component. End-to-end: shopper sends → merchant replies → shopper sees it. | **L** |
| **4** | **Triage: status, assignment, block, context** | `chat:manage`; status (Terbuka/Ditunda/Selesai) + assignee via `DropdownMenu`; block visitor; context sidebar (customer/order/product links); filter tabs + counts. | **M** |
| **5** | **Identity upgrade + notification** | `checkout.astro` passes `vid` → `/api/public/order` links `chat_visitors.customer_id` + `conversations.customer_id/order_id`; "Tautkan ke pelanggan" manual action; Dashboard "Obrolan belum dibaca" card; topbar badge. | **M** |
| **6** | **Ticketing polish (`/bantuan` ↔ `/tiket`)** | move `support` actions onto `withCurrentTenant`/`withTenant` + `support:write`; unread counters + badges; assignment to `platform_admins`; filter tabs on `/bantuan`; reuse the shared `<Thread>`; fix the `Date.now()`-in-render hydration risk. | **M** |
| **7** | *(deferred, only on demand)* **SSE upgrade** | `GET /api/chat/stream` with one `LISTEN/NOTIFY` fan-out per container; client falls back to polling. Same payload contract as slice 2 ⇒ no schema/UI change. | **M** |

Slice 1 is pickup-ready with no open questions blocking it. Slices 2–6 assume the §8 answers default to the choices stated there.

---

## 8. Open questions (for the user)

1. **Merchant notification when a shopper messages.** In-app badge only (v1 default), or also email / WhatsApp / browser push? Push needs a service worker + VAPID keys; WA needs a business API (we only do `wa.me` hand-off today).
2. **Business hours / auto-reply.** Do we ship an away-message + "jam operasional" setting (`store_settings`) in v1, or always show "kami balas segera"? Recommended: a simple away message, since ad traffic lands at 2am.
3. **Read receipts / typing indicators for the shopper.** `read_at` is in the schema; showing "Dibaca" and typing dots pushes toward SSE. Default: **no** in v1.
4. **Attachments (image upload) in chat.** Default **no** in v1 (biggest abuse surface; and Storage is still local disk until MinIO/R2 lands). Shoppers *will* want to send a photo of a defect — v2?
5. **Cross-device thread recovery.** Anonymous = cookie-bound. Do we want an "OTP ke WhatsApp/email untuk lanjut chat di HP lain" flow later, or is losing history acceptable?
6. **Can `gudang` see chat?** Proposed: no. Confirm — some warehouses answer "stok ada?".
7. **Retention / PII.** How long do we keep anonymous visitor rows + message bodies (e.g. purge `chat_visitors` with no customer link + no message in 180 days)? Needed for a defensible privacy posture on a public endpoint.
8. **Nav grouping ("unified app" vision).** Do Obrolan (shopper) and Bantuan (platform) live under one **Pesan** nav group, or stay apart (Obrolan with Pesanan/Pelanggan, Bantuan at the bottom)? Default: apart — they are different axes and merging them in the sidebar re-creates the confusion §1 avoids.
9. **Cloudflare Turnstile** on "start conversation" — ship it now, or wait until we actually get botted? Default: wait, but keep the hook.
10. **Does chat interact with billing at all?** Single plan, so presumably no limits — confirm there is no "N conversations/month" ambition, because that would change the schema (usage counters).
