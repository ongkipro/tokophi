# Environment Parity

Status: operational baseline
Last verified: 2026-08-06 (Asia/Jakarta)

This document defines what "local matches production" means for TokoPhi. It does not contain credentials, customer records, or environment variable values. Device-specific access details belong in `~/.config/ai-local/`, not in this repository.

## Evidence vocabulary

- **Observed** — verified directly from Git, GitHub, Docker, PostgreSQL aggregates, HTTP probes, or Coolify.
- **Decision** — an adopted project rule.
- **Assumption** — plausible but not yet verified.
- **Proposal** — a recommended change that has not been adopted.
- **Unknown** — evidence is currently missing.

## Sources of truth

1. **Code and migrations:** GitHub `ongkipro/tokophi`, default branch `main`.
2. **Production runtime:** the last `finished` Coolify deployment, confirmed by the image tag of all four application containers.
3. **Production data shape:** production PostgreSQL schema and safe aggregate checks. Production data must never be copied ad hoc or printed.
4. **Local mirror:** local Coolify application `tokophi`, deployed from the same GitHub `main` commit with local-only URLs.
5. **Active development:** `/home/ongki/Projects/tokophi-dev`. A dirty worktree is work in progress, not a parity baseline.

**Decision:** memory and documentation are secondary evidence. When they conflict with the running system or repository, runtime/repository evidence wins and the stale documentation must be corrected.

## Verified baseline

| Surface | Observed state | Parity interpretation |
| --- | --- | --- |
| GitHub | `main` at `0e11221727c6` | Canonical code at verification time |
| Production Coolify | deployment `371` finished at `0e11221727c6` | Matches GitHub |
| Production containers | admin, super-admin, storefront, and landing healthy on `0e11221727c6` | Runtime code matches GitHub |
| Production HTTP | landing, admin login, seller route, storefront, custom domain, and shipping query passed | Critical public surfaces healthy |
| Production disk | 169 GB total, 66 GB used, 96 GB available (41%) | Healthy; no cleanup required |
| Production DB aggregates | 1 store, 25 products, 107 variants, 107 inventory rows, 219 orders, 32 customers | Reference aggregate only |
| Local dev DB aggregates | same six aggregate counts as production | Snapshot shape matches production |
| Local Coolify DB aggregates | same six aggregate counts as production | Mirror data shape matches production |
| Production migrations | 91 entries; head `0090_signup_needs_approval` at `1785895700000` | Matches GitHub `main` |
| Local databases before mirror refresh | 90 entries; head `0089_platform_password_revokes_sessions` at `1785895600000` | One migration behind because their runtime/source revision was stale |
| Local Coolify image before refresh | `bfbc81134dae` | Stale; redeployment from current `main` required |
| Local Coolify after refresh | four healthy images at `0e11221727c6`; 91 migrations at `1785895700000`; all four HTTP surfaces returned 200 | Matches GitHub and production |
| Standalone dev DB after refresh | 90 migrations at `1785895600000` | Still paired with the older dirty development worktree; migrate only after that branch safely integrates `main` |
| Development worktree | `dev/rich-local` at `d563dff`, ahead 1 / behind 5, with unrelated uncommitted work | Intentionally not in sync; do not pull over it |

Commit hashes and counts above are a dated audit record, not permanent configuration.

## Intended differences

Local and production should share application code, migrations, seed/snapshot shape, service topology, and non-secret feature configuration. They should intentionally differ in:

- public URLs, callback URLs, cookie domains, and custom-domain routing;
- credentials, tokens, encryption material, and signing keys;
- infrastructure host names and storage paths;
- notification destinations and other side-effect integrations;
- production-only retention, alerting, and availability settings.

**Decision:** compare environment variable names and an explicit non-secret allowlist, never raw environment dumps. Secret equality is not a parity requirement.

## Development workflow

1. Run `tokophi-watch` before starting work. It defaults to the active development worktree and reports local branch, dirty paths, ahead/behind counts, GitHub `main`, last finished production commit, and any active deployment.
2. If the worktree is dirty, inspect ownership of every overlapping path. Do not pull, merge, reset, clean, commit, or deploy another collaborator's changes.
3. Use the existing local PostgreSQL snapshot for data-dependent UI work. Diagnose product price and stock from variants/inventory queries before changing presentation code.
4. Run the package-level checks for touched applications. A successful build is necessary but does not validate browser-visible behavior.
5. Open the affected routes locally and test the real interaction, including loading, empty, error, narrow-screen, and long-title states.
6. Integrate through GitHub `main`; then deploy the local Coolify mirror from that exact commit.
7. Treat production as synchronized only when the deployment is `finished`, all four image tags equal GitHub `main`, all containers are healthy, and the public probe passes.

## Minimum parity checks

```bash
tokophi-watch
coolify context verify --context localhost
coolify --context localhost deploy list
TOKOPHI_PROBE_SKIP_SSH=1 bash ops/tokophi-probe.sh
```

Docker access on this device may require `sg docker -c '<command>'` until a new login session picks up group membership.

For database parity, report only schema identifiers, migration identifiers, and aggregate counts. Never print rows from customers, orders, authentication tables, environment files, or secret-bearing configuration.

Do not print the raw JSON from `coolify deploy get`. Coolify 4.1.2 can include commands marked `hidden` in that response, and those commands may contain authentication material. For routine monitoring, use the deployment list/status fields only.

## Known gaps and risks

- **Observed:** the previous `tokophi-watch` read the stale `/home/ongki/Projects/tokophi` checkout, hiding the active development branch. The device-local command was corrected to default to `tokophi-dev` and accept a path override.
- **Observed:** local data aggregates were already current while product stock/price UI was wrong. The defect class is therefore query/mapping/rendering, not snapshot age.
- **Observed:** production deployment `370` spent a long time in progress and caused a short interval where three application surfaces returned HTTP 503 during container replacement. It recovered and all probes passed.
- **Proposal:** make deployment health gating explicit: start new containers, wait for health, switch traffic, then retire old containers. Until verified in Coolify/Compose, assume deploys can cause brief interruption.
- **Observed:** equal aggregate counts hid a one-migration local schema drift. Parity checks must compare the migration count and head stamp, not only row counts.
- **Unknown:** automatic parity validation of migration history between both local databases and production is not yet a single runnable check.
- **Unknown:** the remote Coolify API token stored on this device did not authenticate during this audit; SSH-based read-only inspection remained available. Rotate/fix it only through the secret-management workflow.
- **Observed:** Vultr API access from this device is rejected by the provider IP allow-list. VPS SSH is healthy; do not weaken the allow-list merely to silence the check.
- **Observed:** Coolify CLI deployment detail JSON can return hidden command content. Treat raw deployment logs as sensitive and do not paste them into issues, prompts, or project documentation.

## Completion criteria

Parity is complete for a revision only when:

- GitHub `main`, local Coolify image tags, and production image tags identify the same commit;
- migrations complete without drift or destructive fallback;
- required containers are healthy;
- critical HTTP and database-backed probes pass;
- safe aggregate data checks match the intended snapshot;
- browser verification passes for the changed routes;
- intended environment differences are documented and no secret is copied into Git or project memory.
