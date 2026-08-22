# FORCE ROW LEVEL SECURITY — measured, and refuted as the fix (2026-08-22)

**Owner authorised applying `FORCE ROW LEVEL SECURITY` to the store-scoped tables. It was measured
first and NOT applied**, because the measurement says it closes nothing today and breaks three
paths tomorrow. This file is the evidence, so the item is not re-filed a third time.

Carried into this session by `2026-08-22-board-analysis-and-4.12-preflight.md` §3 as "an open
question for the owner", after Task 4.12 measured `relforcerowsecurity` on **0 of 54** RLS tables.

## What was run

Two probes against the production database, each inside `begin … rollback`, each on a **scratch
table** created and destroyed in the same transaction. No existing table was altered; no row of
merchant data was read or written; no lock was taken on anything real.

```sql
-- probe 1: does FORCE bind a SUPERUSER owner?
begin;
  create table _rls_probe(store_id uuid, v text);
  alter table _rls_probe enable row level security;
  create policy p on _rls_probe using (false);       -- deny everything
  insert into _rls_probe values (gen_random_uuid(), 'x');
  select count(*) from _rls_probe;                   -- as tokophi (rolsuper = t)
  alter table _rls_probe force row level security;
  select count(*) from _rls_probe;
rollback;

-- probe 2: does FORCE bind a NON-superuser owner?
begin;
  create role _probe_owner nosuperuser;
  create table _t(store_id uuid);
  alter table _t owner to _probe_owner;
  alter table _t enable row level security;
  create policy p on _t using (false);
  insert into _t values (gen_random_uuid());
  set role _probe_owner;  select count(*) from _t;   -- before FORCE
  reset role; alter table _t force row level security;
  set role _probe_owner;  select count(*) from _t;   -- after FORCE
rollback;
```

## Result

| owner | RLS | rows seen through `USING (false)` |
|---|---|---|
| `tokophi` — **superuser**, owns all **81** tables | enabled | **1** (bypassed) |
| `tokophi` — **superuser** | enabled **+ FORCED** | **1** (still bypassed) |
| `_probe_owner` — non-superuser | enabled | 1 (owner bypass) |
| `_probe_owner` — non-superuser | enabled **+ FORCED** | **0** |

`FORCE` binds a table's **owner**. A **superuser bypasses row security unconditionally** and cannot
be forced. Every table here is owned by a superuser.

## Why it is not merely useless — it is the wrong direction

1. **Applied today: zero behavioural change.** A 54-table migration, a changelog entry and a closed
   checkbox over identical behaviour. This repository has already paid for exactly that shape once —
   `DATABASE_RUNTIME_ROLE: app` was set on all three services while the code fell back to the owner
   URL, so the label was true of nothing for months (Task 4.12).
2. **Applied after a demotion: an outage.** `apps/admin/lib/auth.ts` (pre-session `store_users`
   read), the storefront's `getStoreByHost`, and every Super Admin read are cross-tenant **by
   design** and run on the owner connection. Under FORCE they return 0 rows — measured for
   `tokophi_app` earlier the same day: `stores` 0, `store_users` 0, `products` 0, against 14/13/78
   for the owner. That is the login page gone, every shop 404, the control plane blank.

## What would actually reduce privilege (NOT attempted)

Demote `tokophi` from `rolsuper` and leave the tables **unforced**. Owner-bypass keeps the three
paths alive, while the connection loses server-side file access, role management and DDL beyond its
own objects.

Measured prerequisites, same session:

- 🔴 **`tokophi` has NO membership in `tokophi_app`** (`pg_auth_members` → 0 rows). `SET ROLE
  tokophi_app` works today *only* because a superuser may assume any role. A demotion without
  `GRANT tokophi_app TO tokophi` breaks every path that still does it.
- ✅ Only `plpgsql` is installed, so no extension needs superuser at runtime.
- ✅ `app_current_store_id()` is **not** `SECURITY DEFINER`, so policy evaluation does not depend on
  the definer's privileges.
- ❓ **Unmeasured, and the reason this stops here:** whether the deploy-time `migrate` + `seed` chain
  issues any statement that needs superuser. A non-superuser owner can create tables, indexes and
  policies on its own objects, but `CREATE ROLE`/`CREATE EXTENSION` in some future migration would
  fail *during a deploy*. That is a deploy-path change with a blast radius across every release —
  it needs its own task, its own verification on a scratch database, and its own owner decision.

## NEXT

Owner decides between: (a) leave the privilege boundary as it is — Task 4.12 already moved every
merchant read and write onto a genuinely restricted connection, which is where the tenant risk
lived; or (b) open a task for the `tokophi` demotion with the migrate/seed verification above as its
first step. **Do not re-file "add FORCE ROW LEVEL SECURITY" — it is refuted here, with numbers.**
