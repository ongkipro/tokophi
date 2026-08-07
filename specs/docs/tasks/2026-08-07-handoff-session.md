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
- The router is `priority=1` (lowest) and Coolify's own routers outrank it, so a catch-all *should*
  fall through to the storefront, which resolves the tenant from `Host` and 404s what it doesn't know.
  **That claim is untested. Verify it against the live routing table before merging.**
- Unresolved: the rule names only `.tokophi.com`, but `.id` is supposed to be the merchant-facing zone,
  and there is no `.id` anywhere in that compose file. **Establish which is true first.**
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
