# Custom Domain Analysis and Implementation Worklog — 2026-08-07

## Session scope

Investigate Tokophi end to end, reproduce the reported custom-domain failure, prepare the missing Cloudflare for SaaS activation path, and leave production deployment for a later laptop session.

No production deployment or Cloudflare mutation was performed in this session.

## Repository and runtime map

Tokophi has four public surfaces:

- Seller dashboard: Next.js, `apps/admin`.
- Super Admin: Next.js, `apps/super-admin`.
- Shared multi-tenant storefront: Astro SSR, `apps/storefront`; tenant identity comes from the request `Host` header.
- Marketing landing site: Astro, `apps/landing`.

Default merchant storefronts use `<slug>.tokophi.id`. Merchant-owned hostnames are intended to CNAME to `cname.tokophi.cc`, where Cloudflare for SaaS terminates TLS and forwards the original Host header to the shared storefront origin.

## Evidence collected

### Local repository

The first `npm test` after pulling failed only because the new landing dependency graph had not been installed:

```text
Cannot find module '@astrojs/react' imported from apps/landing/astro.config.mjs
```

`npm install` synchronized the existing lockfile dependencies. The next complete gate passed.

The repository already contained:

- `store_domains` schema fields for `provider_id` and `cert_status`;
- seller TXT ownership verification;
- active custom-host resolution in the storefront;
- primary-host redirects and canonical-origin handling;
- a seller domain UI that stopped at `provisioning`.

The repository did not contain:

- a Cloudflare Custom Hostnames API client;
- provider hostname creation after Tokophi ownership verification;
- certificate-status polling;
- a production Traefik router for arbitrary registered merchant hosts;
- Cloudflare for SaaS credentials in the admin runtime.

### Public production probe

`TOKOPHI_PROBE_SKIP_SSH=1 ops/tokophi-probe.sh` passed:

```text
https://tokophi.com                         200
https://app.tokophi.com/login               200
https://rich.tokophi.com                    307
https://toko.tokophi.com                    200
https://batik-nusantara.tokophi.id          200
POST /api/public/ongkir op=search            200 with rows
```

The normal platform surfaces were healthy.

### Custom-domain fallback failure

Public DNS for `cname.tokophi.cc` resolved through Cloudflare, but HTTPS returned:

```text
HTTP 503
no available server
```

A direct request to the origin IP with `cname.tokophi.cc` as Host/SNI returned the same result. The failure was therefore at the origin routing layer, not only at the Cloudflare edge.

The production Traefik dynamic directory contained:

- `default_redirect_503.yaml`
- `tokophi-com-to-id-redirect.yaml`
- `tokophi-id-platform-redirect.yaml`
- `tokophi-origin-tls.yaml`
- `tokophi-stores-id.yaml`

It had no custom-domain router. Coolify's generated `default_redirect_503.yaml` sends unmatched HTTPS hosts to an empty `noop` service at priority `-1000`, which explains the exact `503 no available server` response.

The running admin container reported presence only, never values:

```text
CF_SAAS_ZONE_ID: missing
CF_SAAS_API_TOKEN: missing
```

## Root cause

The custom-domain feature had complete data and seller-ownership groundwork but no activation slice:

1. A seller added CNAME and Tokophi TXT records.
2. Tokophi verified its TXT record and wrote `status = provisioning`.
3. Nothing registered the hostname with Cloudflare for SaaS.
4. Nothing polled hostname and certificate status.
5. Even a manually registered Cloudflare hostname would reach Traefik's empty catch-all instead of the storefront.

A second security issue would have become reachable after adding the catch-all: `slugFromFirstLabel()` accepted the first label of any multi-label hostname, not only the documented `sslip.io` development form. An unregistered hostname whose first label matched a store slug could bypass the intended active `store_domains` lookup. The prepared change restricts this convenience path to `.sslip.io`.

## Implementation prepared

### Cloudflare provider client

Added `apps/admin/lib/cloudflare-saas.ts`:

- Uses native `fetch`; no dependency added.
- Creates `POST /zones/{zone_id}/custom_hostnames` with HTTP DCV, DV certificate type, and TLS 1.2 minimum.
- Retrieves a hostname by provider ID for polling.
- Defines provider deletion for lifecycle cleanup.
- Validates the network response fields used by the application.
- Applies a 10-second request timeout.
- Treats the domain as active only when both hostname status and SSL status are active.
- Maps terminal hostname/certificate states to an actionable error.

Added focused tests in `apps/admin/lib/cloudflare-saas.test.ts` for:

- dual hostname/certificate activation;
- terminal provider failures;
- request URL, payload, and bearer authorization;
- fail-closed behavior when platform credentials are absent.

### Seller verification and retry

Updated `apps/admin/lib/actions/domain.ts`:

- Tokophi TXT ownership remains the first boundary.
- A successful ownership check creates the Cloudflare Custom Hostname.
- Provider ID, certificate status, last check, and provider error are persisted.
- A row with an existing provider ID is polled rather than duplicated.
- Provider creation failures remain visible and retryable.
- Rows attached to a provider cannot be deleted only from Tokophi, preventing an orphan certificate-bearing hostname.

Updated seller domain data/UI:

- The client receives only `providerAttached: boolean`, never the provider ID.
- Error rows can run **Coba lagi**.
- Provider-attached rows remain locked and route changes through support.
- Provisioning copy now states that certificate issuance is automatic.

### Certificate poller and liveness

Added `apps/admin/app/api/cron/domains/route.ts`:

- Uses the existing `CRON_SECRET` fail-closed pattern.
- Polls up to 20 provisioning rows per tick.
- Moves a row to `active` only after both provider states are active.
- Records pending, activated, and failed counts.
- Leaves transient API failures retryable.

Updated `docker-compose.coolify.yml` with a five-minute `cron-domains` sidecar and updated the shared cron-run/Super Admin liveness registry so a dead domain poller becomes visible in Analitik → Sistem.

### Runtime configuration

Added and classified:

```env
CF_SAAS_ZONE_ID
CF_SAAS_API_TOKEN
CUSTOM_DOMAIN_CNAME_TARGET=cname.tokophi.cc
```

The two Cloudflare credentials are required by the live admin environment and are reported only as present/missing by env health. No value is committed.

### Origin routing

Added `ops/tokophi-custom-domains.yaml`:

- HTTPS Host catch-all to `tokophi-stores@docker`.
- Explicit priority `0`.
- Lower than `.com`/`.id` storefront routers at priority `1`.
- Higher than Coolify's empty fallback at priority `-1000`.
- Preserves the request Host header for tenant resolution.

This file is prepared but was not copied to production.

## Validation completed

After dependency synchronization:

```text
npm test
Test Files: 66 passed, 6 skipped
Tests:      556 passed, 52 skipped
Storefront Astro check: 0 errors
Landing Astro check:    0 errors
```

The 52 skipped tests are explicitly DB-coupled ledger/money suites; no local `DATABASE_URL` was available. They were reported as skipped, not passed.

Focused domain and cron tests:

```text
3 test files passed
23 tests passed
```

Admin production build using the repository's documented dummy build-time database URL:

```text
Compiled successfully
TypeScript finished successfully
Static generation completed
```

`docker compose config` is not a valid gate for the existing Coolify compose file because the pre-existing Traefik replacement label intentionally contains `${1}` for Coolify's label handling; standard Compose treats it as interpolation and rejects it. This was pre-existing and unrelated to the domain change.

## Production work deliberately deferred

The following remains for the Mac laptop session:

1. Pull this commit.
2. Create a dedicated Cloudflare API token limited to `tokophi.cc` with **Zone → SSL and Certificates → Edit**.
3. Set `CF_SAAS_ZONE_ID`, `CF_SAAS_API_TOKEN`, and `CUSTOM_DOMAIN_CNAME_TARGET=cname.tokophi.cc` in Coolify.
4. Deploy the committed source changes.
5. Copy `ops/tokophi-custom-domains.yaml` to `/data/coolify/proxy/dynamic/` on the VPS.
6. Use the existing pending merchant hostname for a real TXT → provider → certificate → storefront verification.
7. Promote it to primary and verify the system-domain redirect without redirecting `/api/*`.
8. Re-run the public platform probe to prove the priority-0 catch-all did not hijack landing, seller admin, Super Admin, or system storefront hosts.

The executable handoff is `2026-08-07-urgent-custom-domain-activation.md` in this directory.

## Official Cloudflare references

- https://developers.cloudflare.com/api/resources/custom_hostnames/methods/create/
- https://developers.cloudflare.com/api/resources/custom_hostnames/methods/get/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/create-custom-hostnames/
