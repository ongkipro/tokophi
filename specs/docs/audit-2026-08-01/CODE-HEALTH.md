# CODE-HEALTH — 2026-08-01

Scan of `origin/main` @ **86e3ec3** in worktree `wt-scan`. Nothing was fixed; this is a diagnosis.
Everything below was produced by running the tool, reading the code, querying the DB read-only, or
driving a real browser — not by inference from docs.

**Headline:** every automated gate the repo owns is GREEN except `lint -w @tokophi/admin` (already a
known BACKLOG item). The two things that matter are invisible to all of them:

1. **Super Admin mints every new merchant owner with the hard-coded password `tokophi123`** —
   `apps/super-admin/lib/actions.ts:107`. The rule against this exists in AGENTS.md, and the fix was
   applied to the operator-invite path 20 lines away but not to this one.
2. **The abandoned-cart recovery link is never minted.** `signRecoveryToken` has zero callers and the
   WA template has no link placeholder, while `REQUIREMENTS.md` SEC-13 records it **MET** and
   `UI_INVENTORY.md` records it **✅ real DB**.

---

## 1. Tool results

| Gate | Command | Result | Notes |
|---|---|---|---|
| Unit tests | `npx vitest run` (root) | **PASS** — 16 files, 145 passed | **1 file / 22 tests SKIPPED**: `apps/admin/lib/ledger-credit.test.ts` needs `TEST_DATABASE_URL`. The money tests do not run by default. |
| Admin build | `npm run build:admin` | **PASS** | 2 warnings: multiple lockfiles (`apps/admin/package-lock.json` + root), and `middleware` file convention deprecated in Next 16.2.9. |
| Super-admin build | `npm run build:super` | **PASS** | Only because this worktree has `apps/super-admin/.env.local` copied in. On a clean `origin/main` that file is absent and the build fails — **environmental, already diagnosed, not re-litigated here.** |
| Storefront build | `npm run build -w @tokophi/storefront` | **PASS** | |
| Landing build | `npm run build -w @tokophi/landing` | **PASS** | |
| `astro check` storefront | `npx astro check` (apps/storefront) | **PASS** — 0 errors, 0 warnings, 11 hints | Hints: unused `type Product` import in `produk/[handle].astro:9`, deprecated `AlertTriangle` in `promo/[handle].astro`. |
| `astro check` landing | `npx astro check` (apps/landing) | **PASS** — 0/0/0 | |
| ESLint admin | `npm run lint -w @tokophi/admin` | **FAIL — 19 errors, 23 warnings** | Down from the 28 recorded in BACKLOG on 2026-07-31. Breakdown in §2. |
| ESLint super-admin | `npm run lint -w @tokophi/super-admin` | **PASS** | |
| `tsc --noEmit` | admin, super-admin, db, lib, ui, sections, data | **PASS** (7/7) | |
| Migrations | `npm run verify-migrations -w @tokophi/db` | **PASS** | 86 journal entries, last `0085_payment_lookup_indexes`; stamps increase, idx unique, journal ↔ files match. |
| RLS | `npm run verify-rls -w @tokophi/db` | **PASS** | 13 checks. store-scoped tables with RLS **51/52** (exception `platform_activity`, deliberate). Reports **12** un-RLS'd child tables; AGENTS.md still says 11 — doc drift. |
| Guard: hero srcset | `T_URL=… node apps/storefront/scripts/check-hero-srcset.mjs` | **PASS** | Ran against a real build on :4390. All 3 hero slides resolve to `-1024w.webp`, none to the full-size original. |
| Guard: pixel defer | `T_URL=… node apps/storefront/scripts/check-pixel-defer.mjs` | **FAIL (exit 1)** — but see §2.4 | The deferral itself behaves correctly. The script asserts all THREE vendors; the seeded demo store has only `meta` enabled, so it can never pass locally. |
| Storefront runtime | built server on :4390, 8 routes | **PASS** — all 200, 0 server errors | `/ /checkout /produk /promo /blog /keranjang /kontak /cari`. |
| Checkout flow (browser) | Playwright, `locale: en-US` | **PASS** | Add-to-cart → `/checkout` → kecamatan search → rate load. `POST /api/public/ongkir` 200 ×4, subtotal Rp 110.000 + ongkir Rp 15.700 = **Rp 125.700**. **0 pageerrors, 0 console errors** (excluding `localhost:3000` image 404s — the admin was not running). |
| Guard: responsive audits | `audit:responsive` (admin + storefront) | **NOT RUN** — see §6 | |

Servers used: storefront `node dist/server/entry.mjs` on **4390**, admin `next start` on **3190**.
Both killed by PID (145575, 144755). No `pkill`. No writes to the shared DB beyond whatever the
storefront's own debounced `checkout-session` beacon does on a page that was never submitted.

---

## 2. Confirmed errors, ranked

### 🔴 BLOCKING

#### 2.1 Every store created from Super Admin gets the owner password `tokophi123`
`apps/super-admin/lib/actions.ts:27` · `apps/super-admin/lib/actions.ts:107`

```ts
const DEV_PASSWORD = "tokophi123"; // default local password for provisioned owners/admins
...
const [u] = await tx.insert(schema.users).values({ email, name: ownerName, passwordHash: hashPassword(DEV_PASSWORD) }).returning();
```

**The failure.** A platform operator uses Super Admin → Tambah Toko to onboard `budi@tokosaya.com`.
`createStore` writes a `users` row plus a `store_users` row with role `owner`. That account's password
is the literal string `tokophi123` — which is in this repo, in `AGENTS.md`, and in the README as the
demo login. Anyone who knows the merchant's email address can sign in at `app.tokophi.com` as **store
owner** and reach: every order (buyer name, WhatsApp, full address), the customer table, Pengaturan,
and — via `settings:write` — `saveBankAccount` + `requestPayout`, i.e. change the payout destination
and withdraw the balance. Nothing forces a change and nothing expires it. `createStore` also does not
return the password, so it is never handed to the merchant either: the account is unusable to its
owner and usable to anyone who guesses.

**Why this is credible and not theoretical.** The identical bug was found and fixed 250 lines below,
in `invitePlatformAdmin` (line 361), whose own comment reads: *"Every operator minted here used to get
the fixed `tokophi123`… The store-user add flow already does it this way; this one did not."* Two of
the three account-creation paths were fixed — `invitePlatformAdmin` (`tempPassword()`, revealed once)
and `apps/admin/lib/actions/users.ts:72` (`tempPassword()`). `createStore` was missed. AGENTS.md's own
"patch the class, not the instance" rule names exactly this.

Verified: `apps/admin/lib/actions/register.ts:39` (self-registration) takes the user's own password —
clean. `apps/admin/lib/provision.ts:106` takes `passwordHash` from its caller — clean.

Pre-existing on clean `origin/main`: **yes**.

*(Adjacent, much lower: `tempPassword()` in super-admin is `randomBytes(3)` = 24 bits, vs
`randomBytes(4)` = 32 bits in the admin copy. Two definitions of the same helper, the weaker one on
the control plane. Cosmetic-to-serious depending on how the string is delivered.)*

---

### 🟠 SERIOUS

#### 2.2 The abandoned-cart recovery link is never generated — a shipped feature with no back half
`apps/storefront/src/lib/recovery.ts:43` (`signRecoveryToken`, **0 callers**) ·
`apps/admin/lib/data/checkout.ts:182,205` (`cartMessage`)

**The failure.** The merchant opens `/pelanggan/keranjang`, clicks the WhatsApp button on an abandoned
cart, and sends the shopper a message. The message contains **no link**. The shopper has no way back
to the checkout they half-filled; they must start over. Everything on the storefront side of the
feature — `verifyRecoveryToken`, the `RECOVER` payload, the *"Selamat datang kembali"* banner
(`checkout.astro:254`), the cart restore (`:884`), the field pre-fill (`:975`), the kecamatan restore
(`:1924`), roughly 50 lines of client code — is unreachable.

**Evidence, three independent confirmations:**
- `signRecoveryToken` is referenced nowhere in the repo outside its own declaration (whole-repo grep,
  `.ts`/`.tsx`/`.astro`).
- `cartMessage` fills only `{nama, produk, toko}`. Queried the DB: the `keranjang` template body is
  `"Halo kak {{nama}} 👋, produk *{{produk}}* masih ada di keranjang…"` — no link placeholder exists to
  fill.
- `recovery.ts`'s own header says *"The MERCHANT ADMIN mints these"* and prints the exact `SignJWT`
  call the admin should make. Nobody made it.

**Why it matters beyond the feature:** three docs record this as done —
`specs/docs/REQUIREMENTS.md` SEC-13 status **MET**, `specs/docs/UI_INVENTORY.md:60` *"one-click WA
recovery … via a signed, store-bound, 7-day recovery link"* **✅ real DB**, and
`specs/docs/CODE_MAP.md:113` *"mints/verifies"*. This is the project's own named failure mode: UI
exists, backing integration does not.

Pre-existing on clean `origin/main`: **yes**.

#### 2.3 `createStore` stamps every new store as created **2026-07-02**
`apps/super-admin/lib/actions.ts:28,106,112,113,116`

```ts
const ANCHOR = new Date("2026-07-02T00:00:00Z"); // matches the seed's TODAY so createdDaysAgo reads "0 hari lalu"
```

Written into `accounts.created_at`, `stores.created_at`, `store_users.accepted_at`,
`store_stats.updated_at`. Meanwhile line 110 sets `trialEndsAt = Date.now() + 3d` on the **real**
clock.

**The failure.** A store created today is persisted as created 30 days ago, with a trial ending in 3
days — internally contradictory in the same INSERT. Anything that reads store age is wrong from the
first second: the Toko catalog's age column, `storeSegment()` (`trial → first_month → regular`), and
`health.ts` recency. The gap widens by one day per day. This is the same class as the
`ADMIN_TODAY = 2026-06-30` write in `lib/actions/discounts.ts` that AGENTS.md documents at length
("Never anchor a WRITE to a fixed date") — fixed there, still live here.

The comment admits the motive: the anchor exists so the *read* layer's own frozen anchor renders
"0 hari lalu". Two lies that cancel on seed data and both wrong on real data. See §3.1.

Pre-existing on clean `origin/main`: **yes**.

#### 2.4 `check-pixel-defer.mjs` cannot pass against the repo's own demo store
`apps/storefront/scripts/check-pixel-defer.mjs:104-110`

```ts
stubs.fbq === "function" && stubs.gtag === "function" && stubs.ttq !== "undefined" && … && hosts.length === 3
```

Ran it against a real build on :4390 with `T_URL`. Output:

```
STUBS (synchronous): {"fbq":"function","gtag":"undefined","ttq":"undefined","dataLayerLen":0,"fbqQueueLen":2,"ttqLen":-1}
vendor <script src> in the served HTML: 0 []
vendor requests after 3 s with NO interaction: 0
BUFFERED after firing 3 events with no SDK present: {"fbqQueueLen":3,…}
vendor requests after interaction: 2  hosts=["connect.facebook.net"]
FAIL
```

**The deferral is working** — 0 vendor scripts in the HTML, 0 requests without interaction, the fbq
queue grows, the vendor loads on interaction. The FAIL is the assertion, which hard-requires all three
vendors while `store_tracking_channels` for `batik-nusantara` has only `meta` enabled (verified by
query). AGENTS.md leans on this script as the thing that catches pixel regressions that build, lint
and `astro check` cannot see. A guard that always says FAIL is a guard nobody will read — the same
argument AGENTS.md already makes about `verify-rls` having been red for weeks.

Honest caveat: I only proved it fails against the **local seeded** store. It may pass in production if
all three channels are configured there. I could not check production.

#### 2.5 Frozen seed anchors survive in 11 more modules (read side)
See §3.1 for the full list and per-screen failures. Grouped here because it is one defect with many
sites, and because the two fixes AGENTS.md records (`discounts.ts`, super-admin `health.ts`) were
instance fixes, not class fixes.

---

### 🟡 MINOR

#### 2.6 ESLint admin — 19 errors
Known and itemised in `specs/docs/BACKLOG.md` §"`npm run lint` is RED on main". Recount today: **19
errors, 23 warnings** (was 28 errors on 2026-07-31 — someone has been fixing them). `next build` does
not run ESLint, so nothing catches this.

| Rule | Count | Sites | My read |
|---|---|---|---|
| `Cannot create components during render` | 12 | `pesanan/massal/massal-client.tsx:131` (`Filter`), `saldo/saldo-client.tsx:96` (`Row`) | **Cosmetic here.** Both are stateless presentational closures (a `<Button>` and a two-`<span>` row). The rule's real cost — a subtree remounting and an input losing focus mid-typing — needs state or a focusable field inside; neither has one. Still worth fixing, but it is not the bug the rule is famous for. |
| `Calling setState synchronously within an effect` | 5 | `command-palette.tsx:73,84`; `navigasi/item-form-dialog.tsx:49`; `pengaturan/sender-address-card.tsx:48`; `produk/[id]/product-editor.tsx:393` | **Cosmetic.** All four are the ordinary "reset derived state when a dialog opens / sync handle from title" pattern. Cascading render, not incorrect output. |
| `Cannot call impure function during render` | 2 | `flash-sale/[id]/page.tsx:15`, `flash-sale/baru/page.tsx:10` | **False positive.** Both are `async` **server** components calling `Date.now()` to compute ISO defaults, deliberately on the server so the client editor has no `Date.now()` in its first render. The file's own comment says so. The React Compiler rule does not know it is a server component. |

23 warnings: `@next/next/no-img-element` ×4, unused `and` import in `lib/actions/flash.ts:3` and
`lib/data/landing.ts:6`, rest unused-vars.

#### 2.7 Build warnings
- `apps/admin/package-lock.json` exists alongside the root lockfile; Next warns it inferred the wrong
  workspace root on every build. One stray file.
- `middleware` file convention deprecated in Next 16.2.9 — rename to `proxy` before the next major.

---

## 3. What the tools cannot see

### 3.1 Frozen seed anchors — 13 sites, of which 2 are WRITES

`grep -rn 'new Date("2026-0[0-9]-'` over `apps/` + `packages/` (excluding seeds and tests):

| File:line | Const | Kind | Concrete failure on 2026-08-01 |
|---|---|---|---|
| `apps/super-admin/lib/actions.ts:28` | `ANCHOR` 2026-07-02 | **WRITE** | §2.3 — every new store is born 30 days old. |
| `apps/admin/lib/actions/articles.ts:8,34` | `ADMIN_TODAY` 2026-06-30 | **WRITE** | `publishedAt: i.published ? ADMIN_TODAY : null` — a blog post published today is stamped **30 Juni 2026** on the storefront. Worse, `fields()` is a full replace applied by `updateArticle` too, so **re-saving an already-published article walks its date backwards** to 2026-06-30. Identical mechanic to the voucher-expiry bug AGENTS.md documents. |
| `apps/admin/lib/data/customers.ts:7,9` | `ADMIN_TODAY`, `ORDERS_TODAY` | read | `joinedDaysAgo = ADMIN_TODAY − createdAt`. A customer who registered today → **−32**. Rendered raw: `customer-detail.tsx:460` → *"Pelanggan sejak -32 hari lalu"*. Also the sort key at `pelanggan-client.tsx:246`. This is the exact "−23 hari" bug AGENTS.md records as fixed in super-admin `health.ts`. |
| `apps/admin/lib/data/crm.ts:7` | `ADMIN_TODAY` | read | `dueDays = dueAt − ADMIN_TODAY`. A follow-up due **today** computes **+32** → renders *"32 hari lagi"*, and the overdue filter `f.dueDays <= 0` (`crm/page.tsx:102`) **never fires**. A merchant with real follow-ups sees an empty "telat" list forever. |
| `apps/admin/lib/data/reviews.ts:7` | `ADMIN_TODAY` | read | `{num(r.daysAgo)} hari lalu` → *"-32 hari lalu"* on a review left today (`ulasan-client.tsx:252,274`). |
| `apps/admin/lib/data/purchases.ts:7` | `ADMIN_TODAY` | read | *"-32 hari lalu"* (`pembelian-client.tsx:380`); `etaDays` for a PO due today reads +32. |
| `apps/admin/lib/data/articles.ts:7` | `ADMIN_TODAY` | read | negative `publishedDaysAgo`. |
| `apps/admin/lib/data/pages.ts:7` | `ADMIN_TODAY` | read | negative `updatedDaysAgo`. |
| `apps/admin/lib/data/orders.ts:8,49,318` | `TODAY` 2026-07-02 | read | `minutesAgo` on the orders list — an order placed 5 minutes ago computes ≈ −43.000 minutes. |
| `apps/admin/lib/data/activity.ts:10` | `ANCHOR` | read | clamped `Math.max(0, …)`, so a real event reads *"baru saja"* forever. Less wrong, still wrong. |
| `apps/admin/lib/data/checkout.ts:16,18,181` | `CHECKOUT_TODAY` | read | `minutesAgo` clamped to 0 → **every live abandoned cart reads "baru saja"**, and since the ranking is `subtotal / (1 + minutesAgo/1440)` the age-decay collapses and ordering becomes value-only. `WINDOW_START` is a fixed 2026-06-02, so the "30-day window" on the cards is really 60 days and widening. |
| `apps/admin/lib/mock/store.ts:7` | `TODAY` | mock | Fine — that is the mock's own frame. |

**Why `tsc` cannot see any of this:** every one of them is arithmetic on two valid `Date` objects
producing a valid `number`. There is no type error, and there is no runtime error either — the screen
simply prints a negative or a zero.

**Why I am confident these are live and not dead code:** each is consumed by a rendered component
(file:line given above), and `Math.max(0, …)` appears at exactly three of the sites, which means the
author already noticed the sign flip somewhere and clamped it rather than removing the anchor.

### 3.2 `desc()` emits bare `DESC` = **NULLS FIRST**; one site contradicts its own comment
`apps/admin/lib/data/order-detail.ts:306`

```ts
.orderBy(desc(schema.payments.paidAt), desc(schema.payments.id))
```

versus `apps/admin/lib/data/orders.ts:234`:

```sql
order by p.paid_at desc nulls last, p.id desc limit 1
```

`payments.paid_at` is nullable (confirmed against the catalog). Drizzle's `desc()` emits no NULLS
clause and Postgres defaults DESC to **NULLS FIRST**, so on an order with more than one payment row
the detail page picks the row that has **never been paid** while the list picks the most recently paid
one. The comment directly above the offending line asserts *"Must match the LIST's definition exactly
… It used to be `id desc` alone, so the list and this page could name DIFFERENT methods for the same
order — including COD vs VA."* The `id desc` half was fixed; the NULLS half re-introduces the same
divergence.

**Honest severity downgrade.** I queried the dev DB: **0 orders currently have more than one payment
row**, so nothing today triggers it. It is reachable — `createOrderPayment` refuses a second bill only
while one is `menunggu`, so a `gagal` VA followed by a retry produces two rows, as does a COD order
later given a gateway payment. And `createShipment` does **not** use this ordering (it derives COD via
`exists (select 1 from payments where method='cod')`, `actions/shipping.ts:512`), so the courier
cash-collection instruction is safe. Verdict: **serious-but-latent**, a display divergence on two
screens, not a money instruction.

Same class, lower stakes: `apps/admin/lib/data/articles.ts:57` orders by `desc(publishedAt)` where
drafts are NULL → **every draft sorts above every published post** in the seller's Blog list. The
storefront is safe (`content.ts:85` filters `status='terbit'` first).

Third site, arguably intentional so listed as a smell only: `lib/data/crm.ts:14`
`asc(leads.lastContactAt)` → ASC is NULLS LAST, so **never-contacted leads sink to the bottom** of a
list sorted "least recently contacted first". If the intent is "chase the coldest first", that is
backwards. I cannot prove the intent, so it stays a smell.

### 3.3 `tokophi_app` holds full DML on every platform policy table
Verified read-only against `tokophi-db`:

```
platform_payout | DELETE,INSERT,SELECT,UPDATE     (rowsecurity = f)
platform_cod    | DELETE,INSERT,SELECT,UPDATE     (rowsecurity = f)
platform_couriers | DELETE,INSERT,SELECT,UPDATE   (rowsecurity = f)
platform_payment_channels | DELETE,INSERT,SELECT,UPDATE (rowsecurity = f)
plans           | DELETE,INSERT,SELECT,UPDATE     (rowsecurity = f)
```

`tokophi_app` is the role every tenant read and write drops into (`withTenant` / `withCurrentTenant`).
These five tables carry the COD cap and province allow-list, `codAllowed` per service, the minimum
payout, the enabled payment channels, and plan pricing. They have **no RLS** (nothing to scope — they
are global) and **no grant restriction**, so the tenant role can rewrite platform policy.

Also: the `stores` policy from `0058` is `FOR ALL` with `USING (id = app_current_store_id())` **and the
same expression as `WITH CHECK`** — so the tenant role may `UPDATE` its own `stores` row, which
includes `comped`, `status`, `trial_ends_at`, `plan`, `current_period_end`.

**Today this is latent**, because the only SQL that runs under `tokophi_app` is SQL we wrote, and none
of it updates those tables. **It stops being latent the moment PostgREST goes live** — AGENTS.md's
stated prod plan is *"PostgREST connecting as `tokophi_app` with the JWT `store_id` claim feeding the
GUC"*, at which point a merchant's own JWT reaches a role that can `UPDATE platform_cod SET max = …`
or `UPDATE stores SET comped = true` for their own store. `verify-rls` structurally cannot see this:
it derives coverage from `store_id` columns and these tables have none.

I am flagging this as a **design gap to close before PostgREST**, not as a live exploit. It should be
`REVOKE INSERT, UPDATE, DELETE ON platform_* FROM tokophi_app` plus column-level grants on `stores`.

### 3.4 Client `<script>` blocks — swept, and clean
The `queueSave is not defined` class is the one `astro check` provably cannot see, because
`astro check` does not process `is:inline` scripts at all.

Method: extracted all **27** `<script>` blocks from `apps/storefront`, `apps/landing` and
`packages/sections` to standalone files and ran ESLint `no-undef` with browser globals plus every
`define:vars` name. **Zero `no-undef` errors.** Six blocks failed to parse as plain JS because they
are TypeScript — all six are *non-inline* (`Chat.astro`, `MarketingPixels.astro`, `Hero.astro`,
`Testimoni.astro`, `lp/[slug].astro`, `produk/[handle].astro`), i.e. exactly the ones `astro check`
does cover, and it reported 0 errors on them. Between the two passes every script block is covered.

Then a second sweep for the *other* half of that class — listeners bound to selectors that no longer
exist. Cross-referenced every `getElementById("…")` / `querySelector("#…")` against the markup of all
`.astro` files. **One hit:**

- `apps/storefront/src/pages/checkout.astro:1443-1444` — `area-derived` / `area-derived-text` do not
  exist in any markup. Confirmed in a real browser: `document.getElementById("area-derived")` →
  `false` on the rendered page (`#cod-hint`, `#dest-summary`, `#dest-text`, `#kodepos`, `#kel-wrap`
  all → `true`). `showArea()` (`:1479`) therefore returns at its first line, always. Its three callers
  (`applyArea`, `clearArea`, `:1929`) all still run their other side effects, and the derived
  Kota · Provinsi is displayed anyway by `renderDestSummary()` via `#dest-summary-admin`. **Dead code
  with no user-visible failure** — the markup was replaced by the "Kirim ke" summary card and the
  writer for the old one was left behind. Cosmetic.

Finally, the checkout was **driven**, not read: en-US browser, real add-to-cart, real kecamatan
search, real rate load. 0 pageerrors, 0 console errors, `/api/public/ongkir` 200, and the money on
screen reconciles (Rp 110.000 + Rp 15.700 = Rp 125.700).

### 3.5 Money / stock / auth / COD paths — read line by line, and they hold
Reporting the negatives because "we checked and it was fine" is worth as much as a finding:

- **Stock** (`api/public/order/route.ts:592-673`): the `FOR UPDATE` lock reads the same row the
  decrement writes (`defaultLocationRow`), quantities are aggregated **by variant** before locking
  (the documented cart-line double-count is closed), variants are locked in sorted id order to avoid
  deadlock, and there is no `GREATEST(…, 0)` clamp. Correct.
- **Payout** (`lib/actions/ledger.ts:69`): `pg_advisory_xact_lock(hashtext(storeId)::bigint)` — the
  legal replacement for the `sum() … FOR UPDATE` Postgres rejects. Bank details are snapshotted onto
  the payout row. Correct.
- **Ledger** (`lib/ledger-credit.ts`): `creditSaleForPayment` excludes `batal` **and** `retur`,
  double-credit is enforced by partial unique indexes + `on conflict do nothing`. Correct. One stale
  detail: the `case when o.status in ('selesai','retur') then 'available'` branch is unreachable for
  `'retur'` because the WHERE excludes it three lines later — dead branch, harmless.
- **COD**: derived from the order's own fact, `exists (select 1 from payments p where … p.method =
  'cod')` (`actions/shipping.ts:512`), and `createShipment` refuses a caller whose `input.cod`
  disagrees (`:529`). Not affected by §3.2.
- **LIKE escaping**: `packages/lib/src/like.ts` is used at all three sites AGENTS.md names
  (`data/areas.ts:47`, `data/orders.ts:157-166`, `actions/taxonomy.ts:26`). No unescaped user string
  reaches a pattern.
- **Voucher**: `lib/promo.ts` filters on `storeId` (the post-`0084` load-bearing filter) and matches
  exactly with `upper(code) = upper($1)`, not `LIKE`.

Two money-shaped smells, neither an error:
- `apps/admin/lib/data/bulk-shipping.ts:109` and `bulk-labels.ts:22` cast `o.total_idr::int`. Money is
  `bigint`; int4 tops out at **Rp 2.147.483.647**. A single order above that throws `integer out of
  range` — a 500 on the packing queue. Unreachable for fashion retail, reachable for a wholesale
  merchant. One-word fix, low priority.
- `apps/admin/lib/data/search.ts:16` loads **every** product and **every** customer (name + email) into
  the ⌘K index, and it is called from `app/(admin)/layout.tsx:36` — i.e. on every admin page render.
  At 20k customers that is a multi-megabyte RSC payload per navigation carrying the full customer PII
  list into the browser. Correct today (24 customers), a wall later.

### 3.6 Actions that can report success over a write that did not happen
Swept all 141 exported actions in `apps/admin/lib/actions/*` + `apps/super-admin/lib/actions.ts`,
matched every `{ ok }`-returning action against its call sites, and read each apparent mismatch.

Most were false positives — `jasa-kirim-card.tsx:83-85` does check `a.ok && b.ok && c.ok`; the various
`run(() => …)` helpers check the result. Genuine ones:

- **`markLabelsPrinted`** — `apps/admin/lib/actions/bulk-shipping.ts:121` returns `{ ok, done }` where
  `done` comes from `.returning()`, precisely so the count is honest. Its only caller,
  `pesanan/massal/massal-client.tsx:120`, does `await markLabelsPrinted(printedNumbers)` and then
  toasts `${printedNumbers.length} label ditandai dicetak` — **the number requested, not the number
  written.** If any number does not match (RLS filters it out with no error), the merchant is told 50
  were stamped while 47 were. The action was fixed for exactly this reason; the caller was not
  updated. AGENTS.md: *"Report what you WROTE, never what you were asked to write."*
- **`deleteLanding`** — `apps/admin/lib/actions/landing.ts:126` returns `Promise<void>` and deletes by
  id with no `.returning()` check. Same shape in the ~40 other `Promise<void>` delete/update actions
  (`deleteArticle`, `deleteCollection`, `deleteLead`, `deleteWaTemplate`, `deleteSegment`,
  `deletePage`, `deleteCustomer`, `deleteFlashSale`, …). Under RLS a row that is not this tenant's
  deletes nothing and raises nothing, and the UI toasts "Dihapus". **I could not construct a realistic
  path by which a merchant obtains a foreign id**, so I am ranking this as a *smell*, not an error —
  the honest version of the finding is "these actions cannot distinguish 'deleted' from 'did not
  exist'", which mostly costs a misleading toast.
- **`bulkDeleteProducts`** was flagged by my sweep as having no callers; on inspection it **does** have
  one (`produk/produk-client.tsx:365`) via an indirection my heuristic missed. Not a finding.

### 3.7 One robustness gap found by driving the browser, honestly reported as unproven
While seeding a cart by hand I wrote `[{handle, qty}]` without a `price` and the checkout rendered
**`RpNaN`** for subtotal, total and the sticky bar — silently, with no console error. Adding to the
cart through the real UI produces the correct numbers, so **this was my malformed input, not a bug**.

What it does show: `checkout.astro` reads `price` out of a `localStorage` blob that "is captured at
add-to-cart and kept forever" (its own comment, `:2397`) and there is no `Number.isFinite` guard
anywhere between the blob and the rendered rupiah. A returning shopper carrying a cart written by an
older build of the cart shape would see `RpNaN` where their total belongs. I cannot prove the shape
ever lacked `price`, so this is a **robustness gap, not an error**.

---

## 4. Dead code inventory

### Dead tables (no reference anywhere outside `schema.ts`)
| Table | schema.ts |
|---|---|
| `stock_transfers` | :498 |
| `wa_messages` | :782 |
| `notification_templates` | :1312 |

### Dead columns (no reference outside `schema.ts`)
| Column | schema.ts | Note |
|---|---|---|
| `store_settings.payment_channels` | :1174 | **Already documented** in AGENTS.md as deliberately-kept dead. |
| `store_settings.payment_fee_bearer` | — | Same. |
| `stock_transfers.from_location` / `.to_location` | :501-502 | Dead table. |
| `fulfillments.tracking_no` | :706 | AWB lives on `orders.awb`. |
| `wa_messages.followup_id` / `.lead_id` | :785-786 | Dead table. |
| `kiriminaja_areas.city_id` / `.province_id` | :1206, :1209 | Only `district_id` is used as a currency. |
| `shipping_aggregator.api_key` | :1252 | Keys come from env, not the DB. |
| `platform_cod.fee_pct` | :1279 | No pricing code reads a COD fee. |

### Dead modules and exported functions (zero call sites, whole-repo)
| Symbol | File:line | Note |
|---|---|---|
| `signRecoveryToken`, `RECOVERY_TTL` | `apps/storefront/src/lib/recovery.ts:40,43` | §2.2 — this is the important one. |
| `getOrderPayment` + `OrderPayment` | `apps/admin/lib/data/payments.ts:21` | **The whole module is dead.** Also carries a latent bug if revived: it takes the latest payment by `desc(id)` and *then* rejects it if `channelCode` is null, instead of filtering `channel_code is not null` in the WHERE — so a gateway VA followed by any later payment row returns `null`. |
| `weightForOrder` | `apps/admin/lib/shipping-weight.ts:115` | Dead sibling of the live `weightForCart`, which is what `shipping-quote.ts:160` actually weighs with. No behavioural risk — just an unused twin in the shipping-price module. |
| `getAbandonedCart` | `apps/admin/lib/data/checkout.ts:196` | Comment says "for the recovery action" — the recovery action does not exist (§2.2). |
| `getTemplatesByType`, `getDefaultHomepage` | `apps/admin/lib/data/theme.ts` | |
| `rangeDates` | `apps/admin/lib/data/dashboard.ts` | |
| `tiktokVerdict` | `apps/admin/lib/capi.ts` | |
| `puckConfig` | `apps/admin/lib/theme/puck-config.tsx:438` | Alias of `fullConfig`, nobody imports the alias. |
| `useStoreSlug` | `apps/admin/components/admin/store-context.tsx` | |
| `useRole` | `apps/admin/components/admin/permissions.tsx` | |
| `STEP_META` | `apps/admin/components/admin/pelanggan/checkout-step-badge.tsx` | |
| `UrlPatch` | `apps/admin/components/admin/saldo/use-saldo-url.ts` | |
| `cacheClear` | `apps/storefront/src/data/cache.ts` | |
| `paymentFee`, `splitFee`, `feeBearerLabel`, `PAYMENT_FEES`, `FEE_BEARERS`, `FeeKind`, `FeeBearer` | `packages/lib/src/payment-fees.ts` — **entire module** | AGENTS.md says it is "only used for *display*". It is not used **at all**. |
| `courierMeta`, `INSTANT_COURIER_CODES`, `INSTANT_GROUPS` | `packages/lib/src/couriers.ts` | |
| `DAYS`, `ACTIVITIES`, `CUSTOMER_COUNT`, `BLOG_POSTS`, `MENUS` | `apps/admin/lib/mock/store.ts` | Leftovers from the pre-DB era. |

### Dead UI
- `#area-derived` / `#area-derived-text` writer in `checkout.astro:1443-1485` — §3.4.
- Everything on the storefront's recovery-link path (`checkout.astro:110-135, 254-258, 880-895,
  975-980, 1924-1935`) — unreachable while §2.2 stands.

### Not dead — checked and cleared
- **Admin routes**: every non-dynamic `page.tsx` under `apps/admin/app` has at least one link or
  `router.push` pointing at it. No orphan routes.
- Many symbols my first pass flagged (`healthFromSignals`, `code128b`, `barcodeSvg`, `cartMessage`,
  `requireChatRead`, `searchAreaLocal`, `totpAt`, `purchaseFacts`, `creditSalesForOrder`) turned out to
  be used **inside their own module**. They are over-exported, not dead. Not listed above.

---

## 5. TODO inventory

The repo is genuinely clean here — one real TODO in application source.

| Marker | File:line | Seriousness |
|---|---|---|
| `TODO: make these three configurable per store from the admin (the user's plan)` | `apps/storefront/src/layouts/CheckoutLayout.astro:110` | **Low, and deliberate.** Checkout accent is hard-coded `#2563eb` on purpose (documented at length, AA-verified 5.17:1). It is a product decision with a note, not debt. |
| `// …an alignment hack to line up` | `apps/admin/app/(admin)/saldo/saldo-client.tsx:329` | Cosmetic CSS note, not a marker. |
| `specificity hack built precisely to beat this class` | `apps/storefront/src/pages/checkout.astro:774` | Explanatory prose, not a marker. |
| `'RLSHACK'` | `packages/db/src/verify-rls.ts:70` | A test fixture string. Not a marker. |
| `G-XXXXXXX`, `pixelHint` | `pemasaran-client.tsx:377`, `schema.ts:957` | Placeholder text in UI copy. Not markers. |

No `FIXME`, no `XXX`, no `// lazy:` anywhere.

The real open-work list is not in comments — it is `specs/docs/BACKLOG.md` (1700+ lines) and
`specs/docs/tasks/NEXT.md`. I did not audit those for staleness.

---

## 6. What I could not check, and why

| Not checked | Why | What it would take |
|---|---|---|
| **`build:super` on clean `origin/main`** | This worktree has `apps/super-admin/.env.local` copied in. Told not to re-litigate; noted only. | — |
| **`audit:responsive`** (admin + storefront `scripts/audit-responsive.mjs`) | Needs a dev server on a port each script hard-codes; I was scoped to 4390/3190. | Parameterise the port, or run them in a dedicated session. |
| **`check-pixel-defer` against a store with all three channels** | The seeded demo store has only `meta` enabled (verified by query). I will not flip `enabled` on the shared DB to make a test pass. | Run against production, or seed a fixture store. |
| **Whether §2.4 also fails in production** | No production access from this worktree. | Run with `T_URL` pointed at `toko.tokophi.com`. |
| **`ledger-credit.test.ts` (22 money tests)** | Needs `TEST_DATABASE_URL` pointing at a throwaway DB; creating one means `CREATE DATABASE` + a full migrate against the shared container, which is a write. | `CREATE DATABASE tokophi_test` once, then wire it into the default test run so these 22 stop being skipped. This is the single highest-value follow-up in this document. |
| **Order submission end to end** (`POST /api/public/order`) | It writes a real order, decrements real stock and can book a real shipment against the shared dev DB. I read the code instead. | A disposable DB (same one as above). |
| **Whether §2.1 has already been exploited** | Would need production `users` rows and login logs. | Check prod for `users` whose `password_hash` verifies against `tokophi123`, and rotate. |
| **Super-admin and storefront screens in a browser** | I drove the storefront's checkout only. No visual pass on the 5 super-admin screens or the admin's 16 modules. | Playwright sweep per screen. |
| **`packages/db/drizzle/*.sql` migration bodies** | `verify-migrations` proves the journal is sane; it does **not** prove the SQL inside each of the 86 files is idempotent, which is the failure that left 16 migrations unapplied on 2026-07-30. | Grep all 86 for non-idempotent `create index` / `add column` / `create type`. |
| **`getSearchIndex` payload size at scale** (§3.5) | Only 24 customers on the dev DB, so the payload is small and the problem invisible. | Measure with a seeded 20k-customer store. |
| **Intent behind `asc(leads.lastContactAt)`** (§3.2) | No spec states which end of the list is "urgent". | Ask the owner. |

---

## 7. If only three things get fixed

1. **§2.1** — `apps/super-admin/lib/actions.ts:107`: use `tempPassword()` and return it, exactly as
   `invitePlatformAdmin` at :361 already does. One line plus a return field. Then check production for
   any existing store owner still holding `tokophi123`.
2. **§2.2** — either mint the recovery link in `cartMessage` (the exact `SignJWT` call is written out
   in `recovery.ts:26-29`) or mark SEC-13 **NOT MET** and downgrade `UI_INVENTORY.md:60`. Shipping the
   doc without the code is how the next agent builds on a promise.
3. **§3.1 / §2.3** — kill the anchors as a class, not one file at a time. The two WRITE sites
   (`actions/articles.ts:34`, `super-admin/lib/actions.ts:106-116`) corrupt data and should go first;
   the 10 read sites only print nonsense.
