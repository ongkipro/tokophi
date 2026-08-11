# Session close — 2026-08-12 dini hari (post-reboot sweep: 7 PRs, the no-decision queue is EMPTY)

Base at close: `dfe01a9` (origin/main). Written ~01:00 WIB while the LAST deploy was still building —
see ⚠️ below for what was and was not verified on production at that moment.

## Shipped this session, in merge order — every one gated (tests + lint + build) before merge

| PR | what | the part worth remembering |
|---|---|---|
| #253 | `check-h1-floor` 5/6→6/6 | The recorded "seeded suspended" diagnosis was STALE — no dev-DB store is suspended. Real cause: the verify server had no `STOREFRONT_BASE_DOMAIN`, so since SEC-6 every `<slug>.test` but the demo's was answered by the 404 page (whose single `<h1>` produced the misleading `ok` lines). |
| #254 | DEL-2 click-verified + board addendum | The #252 "touch once" debt settled in a real browser (prod build, console capture proven live first): 4 list filters, ⌘K palette, sender-address cascade — 0 errors. OPEN.md re-swept: N59 N60 N61 N63 N44 N47 N48 N35 were already shipped. |
| #255 | N46 credential sweep → `packages/` | Two named exemptions (`seed.ts`, `password.ts`), both PROVED load-bearing (EXEMPT emptied → red naming exactly those two); reach proved by a planted credential going red. |
| #256 | N31 COD fee shown to merchants | `kaCodFee()` parses `setting.cod_fee`/`minimum_cod_fee`/`cod_fee_amount` (fraction `"0.03"` → 3%, `Number("")` trap avoided — null, never invented Rp0). Cek Ongkir dialog only, COD rates only, no provider brand (ADR 0004). |
| #257 | N62 second half — account lock | `failedLoginLocked`: streak ≥ **25** (the 2nd escalation rung, so 2 audit rows precede every lock) refuses sign-in BEFORE scrypt and BEFORE the streak is fed — refused attempts cannot hold a victim's lock open; self-expires 15 min after the last COUNTED failure. Lockout-DOS trade named in cache.ts. |
| #258 | N38 label plumbing (4 of 5) | Service name, both postcodes (own bold fields), sender phone/line, billable weight, `@Rp…` per item — from columns already persisted. **Found en route: bulk labels read `li.variant`, a column that NEVER existed — `getBulkLabels` threw 42703 on every call; bulk "Cetak resi" had never printed.** Fixed from `product_variants.title`. Insurance (column) + sorting code (vendor/webhook) stay open. |
| #259 | N13 `updated_at` + sitemap `<lastmod>` | Migration `0093_catalog_updated_at` — nullable/no-default/no-backfill ON PURPOSE (no lying dates, idempotent under re-run); 10 write sites bump it; products coalesce `created_at`, categories emit only once edited. ⚠️ **Drizzle snapshots had rotted since ~0083** — `generate` dragged applied history incl. a `DROP CONSTRAINT` that would fail; SQL trimmed to 2 columns, snapshot KEPT as catch-up so the next `generate` diffs from truth. |

Also this session, outside the repo: post-reboot verified (kernel 7.0.0-29, `tokophi-db` auto-start
healthy), `apt full-upgrade` completed (the id/sg-mirror 403 on `linux-firmware-amd-misc` was routed
around via the main archive into apt's cache), 5 phased-update packages left held by Ubuntu itself.

## ✅ Production state — ALL SEVEN MERGES LANDED AND VERIFIED (final check ~01:05 WIB)

CI green for all seven. The #259 deploy landed while this file was being written, and was verified
by CONTENT, not by a 200: admin container sha = **`dfe01a9`** · prod
`select max(created_at) from drizzle.__drizzle_migrations` = **`1786470181705`** (0093) · both
`updated_at` columns present (**2**) · live `toko.tokophi.com/sitemap.xml` went **21 → 43**
`<lastmod>` entries, `produk/kemeja-oversized` now carrying `<lastmod>2026-07-21</lastmod>` — its
real `created_at`, not migration day. (During the build, SSH to the VPS timed out intermittently —
the usual shape of a box mid-build; the fleet stayed green throughout and the poll simply retried.)

## The board after this session

**🕐 Time-gated, do TODAY (2026-08-12) after ~17:00 WIB:** raise custom-domain HSTS
`stsSeconds: 86400 → 31536000` in `/data/coolify/proxy/dynamic/tokophi-custom-domains.yaml`
(hot-reload, re-curl the three hosts) — the middleware went in 2026-08-11 evening; give it its full
quiet day. One-way door once browsers hold a year.

**🟢 No-decision queue: EMPTY.** N46, N31, N62b, N38-plumbing, N13 all closed this session; N59 N60
N61 N63 N44 N47 N48 N35 N52 N54 N55 verified closed earlier. What LOOKS open in older docs but is
not: see the addendum in `2026-08-11-handoff.md`.

**🟡 Doable but not no-decision:**
- **N40** — booking still on deprecated `v6.1/request_pickup`; v6.2's destination field names
  contradict its own doc, so this needs a careful sandbox verification pass (booking to the wrong
  village is what migration 0042 exists to prevent). Deserves its own focused session.
- **N41 (wave 7) seed-drift 3-of-5 + DB-PARITY** — read-only measurements against the prod DB (SSH
  exists); nobody has run them.

**🔴 Owner-held keys/decisions (unchanged):** `demo@tokophi.com` credential or impersonation → SEC-4
+ dashboard profiling · R2 token → DR-1 offsite backup (retention is still hours-scale local-only) ·
`eslint-plugin-astro` devDep · narrow CF SaaS token swap · N57 signup-notification transport · N58
mailer · parcel-size-vs-quantity rule · N1 impersonation ADR · N16 `tokophi_app` DML · N25
`color_palettes` orphan · N28 super-admin crawl · N29 rotation runbook (re-measure first).

**🔴 External:** N39 webhook registration path · N41 courier-holiday endpoint (both KiriminAja
support).

## Standing cautions (carried forward, all still live)

Never a catch-all router (formalin owns priority 1) · new `Host()` lines attach
`tokophi-custom-hsts` · status gates the router, never the reverse · the seed is not a migration ·
count migration stamps from the TARGET DB, not the journal · other sessions' worktrees under
`.claude/worktrees/` (`penjaga`, `primitif`, `rowcards`, `seller`, `struktur`) and the root
checkout's untracked UIUX docs are not ours to sweep.
