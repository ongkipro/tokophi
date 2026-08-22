# Board analysis 2026-08-22 — what is actually done, and the ONE P0 left (Task 4.12)

**Measured against `origin/main` @ `9107078` and the live box, 2026-08-22.** Written before any
remediation code in this pass. This file is an analysis + a preflight, not a second task board:
root [`TASKS.md`](../../../TASKS.md) stays the queue.

## 1. Where the queue actually stands

Derived by cross-referencing every `### Task N.M` heading in `TASKS.md` against the execution
entries in `BUILD-LOG.md` (the repo's own completion record), not against checkboxes.

| Stage | Recorded complete | Open |
|---|---|---|
| 0–3 (historical intake) | 0.1, 0.2, 1.1, 1.2, 1.3, 2.1, 2.2, 2.3 | — (3.1 → superseded by 4.13; 1.1 → 5.16; 2.1 → **4.12**) |
| **4 — P0 release blockers** | 4.1–4.11, 4.13 (12 of 13) | 🔴 **4.12 only** |
| 5 — P1 | 5.2, 5.3, 5.5, 5.10, 5.11, 5.16, 5.17 | 5.1, 5.4, 5.6, 5.7, 5.8, 5.9, 5.12, 5.13, 5.14, 5.15, 5.18, 5.19, 5.20 |
| 6 — P2 | — | 6.1–6.9 |
| 7 — release gate | — | blocked behind Stage 4 |

**Wave-2 lanes are in flight in other worktrees** (branches `feat/stage5-lifecycle` (5.7),
`feat/stage5-store-context`, `fix/stage5-shipping-analytics`, `fix/stage5-checkout-editor`,
`feat/stage5-superadmin`). This pass deliberately takes **Wave 1 lane H — Task 4.12**, the last
open P0 lane, whose declared dependency is `None`.

Production drift note, now closed: the 2026-08-15 rollup recorded production running `3785a36`,
a commit on no branch. Measured today, all four containers run **`9107078` = main tip**. The drift
resolved itself when main moved forward and rebuilt; `recover/prod-20260814` remains the archive.

## 2. Task 4.12 preflight — production is labelled restricted and is not

`DATABASE_RUNTIME_ROLE=app` is set on the production containers. `APP_DATABASE_URL` **is not set**.
`packages/db/src/client.ts:8` reads:

    const appUrl = process.env.APP_DATABASE_URL ?? ownerUrl;

so app-role mode silently resolves to the OWNER connection. Measured on the production database:

| fact | value |
|---|---|
| `DATABASE_RUNTIME_ROLE` (all app containers) | `app` |
| `APP_DATABASE_URL` | **absent** |
| role `tokophi` (what the apps actually connect as) | `rolsuper = t`, `rolbypassrls = t` |
| role `tokophi_app` | `rolcanlogin = f`, **no password** |
| tables with `relforcerowsecurity` | **0** |
| tables with `relrowsecurity` | 54 |

Consequences, stated plainly:

- The runtime identity is a **superuser with BYPASSRLS**. The 54 RLS policies are real but are not
  what protects a query issued outside `withTenant()` / `withCurrentTenant()` — those wrappers
  still work, because `SET LOCAL ROLE` does not require the target role to be able to log in.
- `FORCE ROW LEVEL SECURITY` is on nothing, so even a non-superuser table OWNER would bypass its
  own policies. That is a second, independent gap from the connection identity.
- This is exactly why Task 2.1 was recorded as "changed labels but did not prove a restricted
  runtime, superseded by Task 4.12". The label has been in place; the identity has not.

## 3. 🔴 Ordering constraint — the code fix ALONE takes production down

Task 4.12 requires removing the owner fallback and failing closed. On today's production that fix
lands on a box with no `APP_DATABASE_URL` **and** a `tokophi_app` role that cannot log in, so the
first deploy after the merge would refuse to serve on all four surfaces. That is the same class as
the 2026-08-12 nine-minute outage (`STORE_SLUG` env ↔ healthcheck coupling): a correct code change
whose environment had not been prepared first.

**The infrastructure step must precede the merge, not follow it.** All three parts are
owner-gated (production credential + env change) and are NOT executed by this pass:

1. Give the restricted role a login: `ALTER ROLE tokophi_app WITH LOGIN PASSWORD '<generated>'`
   (production write).
2. Set `APP_DATABASE_URL` in Coolify for `admin`, `super-admin`, `storefront`, pointing at
   `tokophi_app` (env change; the app services already forward `DATABASE_RUNTIME_ROLE`).
3. Verify the restricted identity answers before the code that depends on it ships — connect as
   `tokophi_app` and confirm `rolsuper = f`, `rolbypassrls = f`, and that a tenant-scoped read is
   still correct.

Only then merge the fail-closed code. Until that sequence is agreed, the code change ships behind
its own env: with `DATABASE_RUNTIME_ROLE` unset or `owner`, behaviour is unchanged.

**Open question for the owner, recorded rather than assumed:** whether `FORCE ROW LEVEL SECURITY`
should be added to the store-scoped tables in the same movement. It closes the owner-bypass gap,
and it is a migration touching 54 tables — a separate, deliberate decision, not a rider on 4.12.

## 4. Also open, unchanged and not touched by this pass

- **HSTS custom-domain raise** (`stsSeconds: 86400 → 31536000`): filed time-gated on 2026-08-12,
  skipped on instruction, still reopenable. Infrastructure change, owner-gated.
- **N40 phase 2**: one-line version bump plus one sandbox verification booking; another stream's
  contract (`docs/n40-v62-contract`).
- **D2 / D3** from the 2026-08-12 post-ship audit: deferred with their exact fixes recorded in
  `2026-08-12-deferred-d1-d4.md`.
- **Owner keys**: R2 token (DR-1, backups still local-only), `demo@tokophi.com` / impersonation
  credential (SEC-4).
