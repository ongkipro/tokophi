# Can `tokophi` stop being a superuser? — the migrate/seed privilege probe (2026-08-23)

**Measured, on a scratch database, before proposing any change to production.** This answers the
question left open by `2026-08-22-force-rls-measured-and-refuted.md`: FORCE RLS is the wrong lever,
and the real one is **demoting the owner role** — which is only viable if the deploy-time
`migrate` + `seed` chain survives without superuser. It does, with one named exception.

## How it was measured

On the **local dev Postgres** (never production), in a database of its own so nothing shared was
touched, and dropped afterwards:

```sql
create role probe_owner login password '…'
  nosuperuser nocreaterole nocreatedb nobypassrls;   -- strictly less than tokophi has today
create database tokophi_privprobe owner probe_owner;
```

Then **all 100 migration files from `origin/main`**, in journal order, applied as `probe_owner`
(`psql -v ON_ERROR_STOP=1 -1 -f` per file, i.e. one transaction each, the way drizzle applies them).

## Result

| question | answer |
|---|---|
| Do the 100 migrations need superuser? | **No. 0 of 100 failed** as a `nosuperuser nocreaterole nocreatedb nobypassrls` owner. |
| Then why doesn't `CREATE ROLE tokophi_app` block it? | It is wrapped in `DO $$ IF NOT EXISTS (SELECT FROM pg_roles …) $$` (migration `0012`), and **roles are CLUSTER-wide, not per-database** — the role already exists, so the branch is skipped. |
| Disaster recovery onto a **new cluster**? | 🔴 **Blocked.** `create role dr_probe_role nologin` as `probe_owner` → `ERROR: permission denied to create role`. A cluster with no `tokophi_app` needs `CREATEROLE` (or a bootstrap step). |
| Does the seed chain need privilege? | **No.** It is DML plus `truncate` on tables the role owns; no `CREATE ROLE`, no `CREATE EXTENSION`, no `ALTER SYSTEM`. (Only `plpgsql` is installed, and it ships with PostgreSQL.) |

## 🔴 The dependency that is easy to miss, and it is on OUR OWN rollback path

`tokophi` holds **no membership** in `tokophi_app` (`pg_auth_members` → 0 rows). `SET ROLE
tokophi_app` succeeds today only because a superuser may assume any role.

- In production **as it runs now** this does not matter: `withTenant` executes on the `appDb` pool,
  which connects *as* `tokophi_app`, and a role may always assume itself.
- But **Task 4.12's documented rollback is `DATABASE_RUNTIME_ROLE=owner` on admin**. That makes
  `appDb` the owner pool again, and `rls.ts:33` then runs `set local role tokophi_app` on it. On a
  demoted `tokophi` with no membership, **every merchant read and write would fail** — the rollback
  we rely on in an incident would itself be the incident.

So `GRANT tokophi_app TO tokophi;` is not optional tidiness; it is what keeps the escape hatch open.

## Recipe, if the owner decides to proceed (NOT executed)

```sql
GRANT tokophi_app TO tokophi;    -- FIRST: keeps Task 4.12's rollback path alive
ALTER ROLE tokophi NOSUPERUSER;  -- keep CREATEROLE (see DR row above) unless a bootstrap
                                 -- step is documented instead
```

- **Leave the tables UNFORCED.** Owner-bypass is what keeps auth's pre-session read, the storefront's
  Host resolution and Super Admin alive; that is the whole finding of the FORCE probe.
- `BYPASSRLS` can also be dropped — `tokophi` owns all 81 tables and they are unforced, so
  owner-bypass already covers the cross-tenant reads. Drop it in a **separate** step, and re-measure
  those three paths before and after, or it becomes the same untested claim this codebase keeps
  paying for.
- **PostgreSQL 16 makes `CREATEROLE` far narrower than it used to be** — a `CREATEROLE` role can only
  administer roles it created, so it is no longer a back door to superuser.
- What this buys: the connection every app surface holds loses server-side file access, role
  management, `ALTER SYSTEM`, and DDL beyond its own objects. What it does **not** buy: cross-tenant
  isolation on the owner paths — those are cross-tenant by design (see `SECURITY.md` §4).

## NEXT

Owner decision. If yes, run the two statements above against production, redeploy nothing (they take
effect on the next connection), then re-verify: the four surfaces, the admin identity-gate log, both
pools in `pg_stat_activity`, and one merchant read through `withTenant`. If no, this file records why
the question is settled and what it would cost to reopen.
