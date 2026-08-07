# Handoff — 2026-08-07 (cold start)

Base: `origin/main` = `4e4bcbb`. Production containers = `f6fcb79`.

> ## ⚠️ READ THIS FIRST — production being "behind" main is NORMAL
> The Coolify application has a watch path **`!**/*.md`**. Docs-only merges are skipped **by design**,
> and GitHub answers `200 OK` with `"Changed files do not match watch paths. Ignoring deployment."`
>
> **Do not diagnose this as a broken webhook.** I did, twice, and wrote two confident documents about a
> "dead delivery path" before asking GitHub what the webhook actually replied. Both are retracted in
> `2026-08-06-open-work.md` under DEL-3 — read the retraction before you touch deploy monitoring.
> **A code merge deploys normally.** Verify with the container sha only after a **non-`.md`** merge.

## State of the fleet (measured 2026-08-07)

7 stores. `page_templates`: `batik-nusantara` has homepage+category+product; `permata-store` and
`valoish-store` have homepage only; **`zanobyshop`, `beautyinyu`, `difa-pack`, `hamandia` have none**
and already render the fallback at `apps/storefront/src/pages/index.astro:50`. Four of seven owning no
template is the **majority case, live and working** — not an edge case to design around.

## The work, in the order I would do it

### 1. DOM-2 — custom domains (highest value, one careful step)
Cloudflare half is **done**: `cname.tokophi.com` A→45.77.33.112 proxied, fallback origin set, custom
hostname `beautyinu.co` created (Free plan allows it). The merchant's DNS was correct all along.

**Blocker:** `docker-compose.coolify.yml:167` routes storefronts with
`HostRegexp(^[a-z0-9-]+\.tokophi\.com$)` — it matches nothing else. When CF starts forwarding
`beautyinu.co` the origin 404s, so **CF goes green while the site stays broken** — worse than today
because it looks finished.

⚠️ This label serves **every** merchant storefront. Get it wrong and they all go down together.
- ⛔ **The catch-all idea was tested and FAILED. Do not build it.** Priority 1 is already occupied by
  `formalin-web` — a different live application on this same proxy. A tokophi catch-all at priority 1
  ties with it on every `*.formalin.store` host; raising ours to 2 would hijack their subdomains
  outright. **Use an explicit `Host()` list** for verified custom domains instead: deterministic, long
  rule ⇒ high default priority, no collision. Costs one deploy per domain, fine at 7 stores.
  *(Confirmed true and reusable: every tokophi router sits at 38–100, and the storefront already 404s
  foreign hosts cleanly — `beautyinu.co`, random hosts, all 404 at `:4327`.)*
- ✅ **RESOLVED — do not re-investigate.** `.com` is ours (Seller, Super Admin, landing, platform);
  `.id` is merchants. **`.id` has been live since 16 July** — `batik-nusantara.tokophi.id` → 200,
  `<slug>.tokophi.com` → 301 → `.id`, `app.tokophi.id` → 301 → `.com`. It is **not** in
  `docker-compose.coolify.yml`; it lives in `/data/coolify/proxy/dynamic/` (`tokophi-stores-id.yaml`,
  `tokophi-com-to-id-redirect.yaml`, `tokophi-id-platform-redirect.yaml`), which is **not in the repo**.
  There is nothing to migrate. DOM-2 is **only** merchant custom domains.
- Then flip `store_domains.status` to `active` and confirm `curl -sI https://beautyinu.co` → 200.

### 2. T-9 / UX-1 — platform default theme, decision **B-hard**
Owner's words: *"timpa yang sudah punya template."* The platform default is what every storefront
renders; a store's own rows stop being served.
- **Do NOT delete their rows.** B-hard is a render-time rule. Those rows are the only record that
  `permata-store` and `valoish-store` ever built anything, and the only way back.
- Build the off-switch so someone can point at it.
- This deliberately overrules `index.astro:172` (*"that would be us editing their homepage"*) — the
  comment survives, so leave a note or the next reader will "fix" the behaviour back.

### 3. T-10 / UX-2 — lock imagery to 1:1
Six sites, all still `"3:4"`: `packages/sections/src/registry.ts:122,458` ·
`apps/admin/lib/theme/puck-config.tsx:238-242` (drop the merchant dropdown) ·
`apps/storefront/src/components/ProductCard.astro:16,19,63` ·
`.../sections/ProductGrid.astro:9,50` · `apps/storefront/src/pages/produk/[handle].astro:316,345`.
The renderer must **ignore** any stored `imageRatio` — not merely default to 1:1.
Independent of the B-soft/B-hard question; can ship on its own.

### Also open
**DOM-1** `tokophi.id` apex 503 · **SEC-1** an unapproved store's storefront is fully public
(product decision: 404 / neutral page / normal) · **DR-1** backups have no offsite copy ·
**T-4** `.id` `min_tls_version` still 1.0 · **SEC-4** `Secure` never observed on a real `Set-Cookie` ·
**DEL-2** 11 ESLint errors; `storefront`/`landing` have no lint script.
**T-12 is WITHDRAWN** — built on the false premise above; do not implement it as written.

## House rules that cost me time
- **Sink beats source.** Repo-wide scans over tracked files, never a hand-list of paths.
- Guards must read a file's **code**, not its text — `test/source-code.ts` (`codeOnly()`).
- Spec docs: `Done when:` needs a **colon on the same line**; the validator splits on `:`. Run
  `python3 ~/dotfiles/skills/local/development-spec-suite/scripts/check-traceability.py specs/docs/tasks/`.
- Migrations: check `packages/db/drizzle/meta/_journal.json` — a stamp below the newest is **skipped
  silently** while printing success.
- Other agents share this worktree, this DB and this box. `git status` first; commit with a pathspec.

---

## Complete open backlog, ordered — written without being asked, 2026-08-07

Ranked by *cost of leaving it undone*, not by effort.

### Serving customers wrong / security
1. **SEC-1 — an unapproved store's storefront is fully public.** `getStoreBySlug` filters on slug only;
   zero references to `suspended`/`approved_at` in `apps/storefront/src`; `StoreInfo` carries no
   `status`. Latent today (queue empty, all 6 approved) — **it stops being latent the day signup is
   busy.** Needs a product decision first: 404, neutral holding page, or serve normally.
2. **SEC-4 — `Secure` has never been observed on a real `Set-Cookie`.** The code is right
   (`packages/lib/src/session-cookie.ts`); nobody has watched one production login to confirm it.
   One login, one header dump. **Cheapest unverified security claim we have.**
3. **T-4 — `.id` `min_tls_version` is still 1.0.** A compatibility call, not a technical one.

### Losing data
4. **DR-1 — backups have no offsite copy.** They live on the same VPS as the database. The restore
   drill passed and RPO was measured, so the *procedure* is proven — **the single point of failure is
   that one box.** Highest-value infra item here.

### Merchant-visible
5. **DOM-2 — custom domains.** Cloudflare half done; explicit-`Host()` router remains. `beautyinu.co`
   is a real merchant waiting. Flip `store_domains.status` → `active` and prove `curl -sI` → 200.
6. **DOM-1 — `tokophi.id` apex returns 503.**
7. ~~T-9 / T-10~~ — **both SHIPPED 2026-08-07.** T-10 (`8d3767f`) is live and locking imagery to 1:1.
   T-9 (`b5278e9`) is deployed **OFF**: `PLATFORM_DEFAULT_THEME_STORE_ID` is unset, so every store still
   renders its own theme. **Turning it on is a deliberate env-var flip in Coolify, done while watching** —
   see T-9 in `2026-08-06-open-work.md` for the exact procedure and the blank-value trap.

### Hygiene
8. **DEL-2 — 11 ESLint errors; `storefront` and `landing` have no lint script at all.** The missing
   script is worse than the errors: two surfaces are unlinted and nobody sees it.
9. Repo debt: ~26 dirty worktrees, ~60 branches, 5 with migration journals stamped below main.
   **The journal one can silently skip a migration — see the CLAUDE.md landmine.**

## What I would tell my replacement about *how* I worked

I was wrong three times today, and all three had the same shape: **I inferred system state from
configuration instead of observing behaviour.**

- Deploy "broken" → never read the webhook's reply. It said `watch_paths: ["!**/*.md"]`.
- "No `.id` anywhere" → grepped the repo, never `curl`ed a `.id` host. It had been live for three weeks.
- "Priority 1 is free" → assumed; another live app was already sitting there.

Each cost more than the fix would have. **Before writing that something is broken, run the one command
that would prove it works.** And when a second observation seems to confirm the first, check that it
isn't just the same cause seen twice — I "confirmed" the deploy theory across four merges that were all
docs-only, and mistook repetition for evidence.


## Added 2026-08-07 — two traps this session paid for, in the hope you don't

**1. A pipe swallows the exit status.** `npm run build:admin 2>&1 | tail -6 && git commit …` reads
`tail`'s status, not `npm`'s. The admin build failed and the commit and PR went out anyway; only reading
the log caught it. Same shape as the `mv "$f.part" "$f"; echo backup-ok` bug in the backup service.
**Redirect to a file, capture `$?`, then branch on it.**

**2. A test that cannot fail for the right reason is worse than no test.** A pure resolver placed in a
module that imports `@tokophi/db` threw on `DATABASE_URL` before any assertion ran — so the mutation
check "failed" and looked like proof the guard worked. **Always mutation-test: break the logic on
purpose and confirm the test goes red for the reason you expect**, not merely that it goes red.

Both are the same underlying error as the three inference mistakes listed above: **accepting a signal
that looks like confirmation without checking what actually produced it.**


## Session close 2026-08-07 — measured state, and what each blocker actually is

**Shipped and verified live:** T-10 (`8d3767f`, deploy 407) · T-9 (`b5278e9`, deploy 408, **OFF**).

**Production is now 8 stores, not 7** — `petanihandal` (`jhonkyber@gmail.com`) appeared during the
session. ⚠️ **That moves SEC-1 out of "latent".** An unapproved store's storefront is fully public, and
signups are demonstrably happening. It needs a product answer (404 / neutral page / normal), soon.

**Every remaining blocker is one specific missing thing, not effort:**

| item | blocked on |
|---|---|
| SEC-4 + dashboard profiling | a production credential — `demo@tokophi.com`, or super-admin impersonation via `ongkiardiansyah@gmail.com` |
| DR-1 | a Cloudflare token with **Account → R2 → Edit** + an R2 access key |
| SEC-1 | a product decision |
| DOM-2 | nothing — it is buildable now (explicit `Host()` router) |

⚠️ **Credentials in memory are not credentials in production.** `ongki@batiknusantara.id / tokophi123`
is the LOCAL SEED and does not exist on the live database; it cost this session two failed login
attempts and one wrong diagnosis. **Check `users` on the box before trusting any login you were told.**

**Performance, measured — no smoking gun found.** Storefront FCP 532ms / load 542ms / 238KB / 0 console
errors. Seller `/login` FCP 656ms / load 903ms. Landing FCP 596ms. The dashboard page already uses
`Promise.all`, so it is not serially awaiting. 59 admin pages are `force-dynamic` and 133
`withCurrentTenant` calls each open their own transaction — a real cost that scales with store count,
but not a defect. **The authenticated dashboard remains the one thing never measured**, and that is
exactly where the slowness was reported. Do not theorise about it further until it has been profiled.

Two smaller, real findings: `/hero/` and `/fonts/` (**166KB**) return `cf-cache-status: EXPIRED` while
`/_astro/` correctly gets `immutable` — they revalidate to origin on every visit and should not.
And storefront **HTML** is `DYNAMIC` at Cloudflare, i.e. never edge-cached; caching it is a real lever
but must be done carefully on a multi-tenant SSR site with carts.

**Infra is not tight.** Disk 47GB/169GB (29%), RAM 2.1/7.7GB, load 0.91. Images are NOT the problem —
0 dangling, 157MB reclaimable. Build cache holds 11.49GB but all of it is under 48h old, and pruning now
would only slow the next deploy. The growth rate (33→47GB in a day of deploys) is what to watch; a
weekly `docker builder prune --filter until=168h` is the fix, and it was NOT installed — it is a
system-wide change and was left for approval.

⚠️ The biggest single-image cost is `_migrate` at **1.94GB × 4 tags** — a container whose only job is to
run migrations is as large as the full app. Almost certainly inheriting the whole admin build stage.
Best size win available, and the most isolated to change.
