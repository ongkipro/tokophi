# Do the owner-mode surfaces need OWNER privileges? — measured (2026-08-23)

**No.** A `NOSUPERUSER` role with `BYPASSRLS` and ordinary DML grants does everything
`apps/admin` (owner paths), `apps/super-admin` and `apps/storefront` ask of the database. This is
the last unmeasured risk from `2026-08-23-owner-demotion-privilege-probe.md` option **(a)**, which
became the only remaining lever once demoting the bootstrap role proved impossible.

Still **not implemented** — this file is the evidence that it *can* be, and what it costs.

## Pass 1 — static: what SQL do those three surfaces actually issue?

Over `apps/admin/**`, `apps/super-admin/**`, `apps/storefront/**`, tests excluded:

| looked for | found |
|---|---|
| `.unsafe(` — raw, unparameterised SQL | **0** |
| DDL (`create`/`alter`/`drop` table·index·policy·function·type) | **0** |
| `truncate`, `grant`, `revoke`, `alter default privileges` | **0** (the 90+ text matches are Tailwind's `truncate` class and prose) |
| `refresh materialized view`, `listen`/`notify` | **0** |
| verbs inside `sql\`…\`` templates (230 call sites) | `select`, `delete`, and expressions — `now()`, `coalesce`, `case`, `exists`, `nullif`, `extract` |
| `set local role` / `set_config` outside `packages/db` | **0** — role switching lives only in `rls.ts` |

Everything else goes through drizzle, which emits `select` / `insert` / `update` / `delete`.

## Pass 2 — empirical: build the proposed role and run the real patterns

On local dev (never production), a role with **strictly** the proposed shape:

```sql
create role probe_platform login password '…' nosuperuser nocreatedb nocreaterole bypassrls;
grant usage on schema public to probe_platform;
grant select, insert, update, delete on all tables in schema public to probe_platform;
```

| path it stands in for | result as the proposed role | owner's own answer |
|---|---|---|
| auth's pre-session read — `store_users` | works | same |
| storefront `getStoreByHost` — `stores` | **8** | **8** |
| Super Admin cross-tenant — `count(distinct store_id)` over `products` | **1** | **1** |
| Super Admin platform tables — `platform_admins` | works | same |
| `INSERT` + `UPDATE` + `DELETE` round trip (rolled back) | all three ok | — |
| `create table _should_fail(x int)` | 🔴 **ERROR: permission denied for schema public** | (owner may) |

The counts match the owner's **exactly**, which is the point: `BYPASSRLS` reproduces the
cross-tenant visibility those three surfaces are built on, without superuser. And the last row is
the half that makes it worth doing — the connection can no longer change the schema.

⚠️ **Cleanup note for whoever repeats this:** `DROP ROLE` fails with *"cannot be dropped because
some objects depend on it — 83 objects"* until the grants are revoked. `revoke all on all tables in
schema public` then `revoke all on schema public`, then drop. The probe role is gone; `pg_roles`
holds no `probe%` row.

## What it would look like

A third role beside the two that exist, each named for one job:

| role | who uses it | privilege |
|---|---|---|
| `tokophi` (bootstrap, superuser — **cannot be demoted**) | `migrate`, `seed` only | everything |
| **new** — e.g. `tokophi_platform` | `DATABASE_URL` for admin · super-admin · storefront | `nosuperuser`, `bypassrls`, DML grants |
| `tokophi_app` | `APP_DATABASE_URL`, `withTenant` only (Task 4.12) | `nosuperuser`, no `bypassrls`, DML grants, RLS applies |

Compose + env change of the same shape as Task 4.12: no migration, no schema change, and the
rollback is one variable per service (point `DATABASE_URL` back at the bootstrap role).

⚠️ **Sequencing that matters, learned from 4.12:** the role and its grants must exist **before** any
service is pointed at it, and a container only receives what its compose block forwards. Also
`ALTER DEFAULT PRIVILEGES` should be set for future tables, or the next migration's table arrives
ungranted and the surfaces start failing on exactly one table.

## What it does and does not buy

- **Does:** the connection every public-facing surface holds stops being a superuser — no
  server-side file access, no role management, no `ALTER SYSTEM`, no DDL. Three of the four
  containers lose the ability to change the database's shape.
- **Does not:** tenant isolation on those paths. They are cross-tenant *by design* (auth before a
  session exists, Host resolution, the control plane) and `BYPASSRLS` is precisely what keeps them
  working. That risk is unchanged and is documented in `SECURITY.md` §4.

## NEXT

Owner decision. If yes: create the role + grants + default privileges on production, point the
three services' `DATABASE_URL` at it, redeploy, then verify with the same falsifiable set Task 4.12
used — four surfaces, the identity-gate log, `pg_stat_activity` showing the expected roles, and one
tenant-scoped read. If no, this file records that the option is viable and measured, so the next
person does not re-derive it.
