# `tokophi_platform` exists on production and nothing uses it yet — deliberate pause (2026-08-23)

**State: role provisioned and verified; NO service points at it; no code changed.** Work was paused
here on the owner's instruction. Everything below is reversible with one statement.

This is step 1 of option (a) in `2026-08-23-third-role-for-owner-mode-surfaces.md`, which was
measured viable after `FORCE ROW LEVEL SECURITY` was refuted and demoting the bootstrap role proved
impossible (`2026-08-22-force-rls-measured-and-refuted.md`,
`2026-08-23-owner-demotion-privilege-probe.md`).

## What was done on production

```sql
create role tokophi_platform login password '…'
  nosuperuser nocreatedb nocreaterole bypassrls;      -- guarded by IF NOT EXISTS
grant usage on schema public to tokophi_platform;
grant select, insert, update, delete on all tables    in schema public to tokophi_platform;
grant usage, select                  on all sequences in schema public to tokophi_platform;
alter default privileges for role tokophi in schema public
  grant select, insert, update, delete on tables    to tokophi_platform;
alter default privileges for role tokophi in schema public
  grant usage, select                  on sequences to tokophi_platform;
```

The **default privileges** are the half that is easy to skip and expensive to miss: without them the
next migration's table arrives ungranted and the surfaces start failing on exactly one table, long
after anyone connects the two events. `FOR ROLE tokophi` is explicit because migrations run as the
bootstrap role, and default privileges attach to the role that CREATES the object.

Secrets were generated **on the VPS** and never entered a transcript or this repository:
`/root/.tokophi_platform_password` and `/root/.tokophi_platform_url`, both root-only.

### Verified immediately, on production

| check | result |
|---|---|
| role attributes | `tokophi_platform` — `super=false`, `bypassrls=true`, `canlogin=true` |
| real login + cross-tenant read | `connected=tokophi_platform stores=14 store_users=13 products=78` |

Those three counts are the owner's own numbers, which is the point: `BYPASSRLS` reproduces exactly
the cross-tenant visibility auth's pre-session read, the storefront's Host resolution and Super Admin
are built on — without superuser.

The three roles now on the cluster, one per job:

| role | used by | privilege |
|---|---|---|
| `tokophi` (bootstrap — **cannot be demoted**) | `migrate`, `seed`, **and still all three app services** | superuser |
| `tokophi_platform` | **nothing yet** | `nosuperuser`, `bypassrls`, DML |
| `tokophi_app` | `APP_DATABASE_URL` → `withTenant` only (Task 4.12) | `nosuperuser`, no `bypassrls`, DML |

## What remains — and the order is the safety property

1. Set **`PLATFORM_DATABASE_URL`** in Coolify from `/root/.tokophi_platform_url`. Safe to do before
   the merge **only because no compose block forwards that name yet** — a container receives only
   what its own block names. This is the same ordering that made Task 4.12 survive.
2. Change `DATABASE_URL` for **`admin`, `super-admin`, `storefront`** in
   `docker-compose.coolify.yml` to `${PLATFORM_DATABASE_URL:?…}`. **Leave `migrate` and `seed` on the
   bootstrap role** — they create objects and (on a fresh cluster) the `tokophi_app` role.
   Leave `APP_DATABASE_URL` untouched.
3. Merge → deploy → verify with the same falsifiable set 4.12 used: four surfaces answering, the
   admin identity-gate line still printing, `pg_stat_activity` showing `tokophi_platform` **and**
   `tokophi_app` (and `tokophi` only for the one-off jobs), and one tenant-scoped read.

**Rollback at any point:** point the three `DATABASE_URL`s back at the bootstrap role — one variable
per service, no migration to undo. If the role itself must go:
`revoke all on all tables in schema public from tokophi_platform; revoke all on schema public from
tokophi_platform; drop role tokophi_platform;` — ⚠️ the revokes are required first, or `DROP ROLE`
fails with *"cannot be dropped because some objects depend on it"* (measured on the local probe: 83
objects).

## ⚠️ Repository visibility changed the same day

`ongkipro/tokophi` was **PUBLIC** and was switched to **private** on the owner's instruction. It is
worth recording *why this is not a no-op for deploys*: Coolify pulls through a **GitHub App**
(`volumdev`, `app_id 4266027`, `installation_id 145699623`, its own private key) rather than an
anonymous HTTPS clone, and an App installation's access is granted per repository and is
**independent of visibility** — so deploys are expected to keep working.

✅ **PROVEN the same day, without waiting for a deploy.** The GitHub REST endpoint that describes an
installation needs a JWT signed by the App itself, so a user token only earns 401/403 — but Coolify
holds the App's private key, and its own helper can be driven from the box:

```php
$t = generateGithubInstallationToken(App\Models\GithubApp::find(1));   // → OBTAINED
// git ls-remote https://x-access-token:$t@github.com/ongkipro/tokophi.git refs/heads/main
// → 54e910b4c68a0ae783538acba3d4b30893cc96ac  refs/heads/main
```

The clone credential resolves and reads the **private** repository's current `main`. Deploys are not
affected. ⚠️ Note the helper is `generateGithubInstallationToken` (camelCase) in this Coolify
version — `generate_github_installation_token` does not exist and returns
*"Call to undefined function"*, which reads like a broken integration when it is only a wrong name.

Undo, should it ever be wanted: `gh repo edit ongkipro/tokophi --visibility public`.

## NEXT

Resume at step 1 above. Nothing is half-applied: production behaves exactly as it did before the role
existed, because nothing references it.
