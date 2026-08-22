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

## 🔴 ATTEMPTED THE SAME DAY — AND POSTGRESQL REFUSED. The recipe below cannot run.

The owner authorised it; it was executed against production in the safe order, and the second
statement was rejected by the engine:

```
GRANT tokophi_app TO tokophi;      -- ✅ applied, verified: pg_has_role('tokophi','tokophi_app','member') = t
ALTER ROLE tokophi NOSUPERUSER;    -- ❌ ERROR: permission denied to alter role
                                   --    DETAIL: The bootstrap user must have the SUPERUSER attribute.
```

**`tokophi` is this cluster's BOOTSTRAP user** — the role `initdb` created from `POSTGRES_USER`.
PostgreSQL forbids removing `SUPERUSER` from it, by *anyone*, including itself. This is not a
privilege we can grant our way around and not a permission problem: it is a property of the cluster.
**Demoting `tokophi` is impossible while it is the bootstrap role**, and no amount of `CREATEROLE`
or membership changes it. Nothing was left half-applied: the state after the attempt is exactly the
state before it, plus the GRANT.

**The GRANT was kept, deliberately.** It grants `tokophi` nothing it did not already have (a
superuser may assume any role), and it is what makes Task 4.12's documented rollback
(`DATABASE_RUNTIME_ROLE=owner`, which puts `set local role tokophi_app` back on the owner pool) safe
under any future owner role. Verified after: both surfaces 200, admin log still
`restricted database identity verified: tokophi_app`, and a tenant-scoped read as `tokophi_app`
still returns **25 products / 1 store** for `batiknusantara`.

### What is actually left, and it is a different shape

Reducing the app's privilege now means **not using the bootstrap role for application traffic** —
never demoting it. Two options, and the first is much the smaller:

- **(a) A THIRD role for the owner-mode paths.** A `NOSUPERUSER` role carrying **`BYPASSRLS`** plus
  the same DML grants `tokophi_app` holds. `DATABASE_URL` for `admin`, `super-admin` and
  `storefront` points at it; `migrate`/`seed` keep the bootstrap role. Auth's pre-session read, the
  storefront's Host resolution and Super Admin keep their cross-tenant reads (that is what
  `BYPASSRLS` buys, and why it must be a *separate* role — putting it on `tokophi_app` would undo
  Task 4.12). This is the same shape 4.12 already proved: one role per purpose, named in compose,
  provable from `pg_roles`.
  ⚠️ Unmeasured, and it is the whole risk: whether those three surfaces touch anything that only an
  *owner* may do (DDL, `truncate`, ownership-dependent grants). Measure before proposing it.
- **(b) Transfer ownership** of the database and all 81 tables to a non-superuser role
  (`REASSIGN OWNED`). Bigger, touches every object, and buys little over (a).

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

**Do not re-file "demote `tokophi`"** — the engine refuses it and the reason is structural, recorded
above with the exact error. The open question is now option **(a)**: measure whether the three
owner-mode surfaces need owner-only privileges, and if they do not, add the third role. That is a
compose + env change of the same shape as Task 4.12, not a migration.

Two things are already true and worth keeping in view: every merchant read and write is already on a
genuinely restricted connection (Task 4.12), which is where the tenant risk lived; and the residual
exposure is that the three *deliberately* cross-tenant surfaces hold a superuser connection rather
than a merely cross-tenant one.
