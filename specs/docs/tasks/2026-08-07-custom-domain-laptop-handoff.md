# Custom Domain Laptop Handoff — 2026-08-07

## Resume point

Continue from:

```text
Remote branch: origin/urgent/custom-domain-activation
Head commit:   b21d450
Base status:   2 commits ahead, 0 behind origin/main
Deployment:    NOT performed
```

The feature branch already includes the five GitHub updates that arrived after the first implementation commit. The overlapping `apps/admin/lib/actions/domain.ts` change was merged manually: upstream CNAME-servability validation and the Cloudflare for SaaS activation flow are both preserved. No force push was used.

## Goal for the next session

Activate one existing pending merchant domain end to end from the Mac laptop:

```text
Tokophi TXT proof
→ CNAME servability proof
→ Cloudflare Custom Hostname creation
→ hostname + SSL polling
→ store_domains.status = active
→ valid HTTPS storefront
→ optional primary-domain promotion
```

## Pull on the Mac

For a new local branch:

```bash
git fetch origin
git switch --track origin/urgent/custom-domain-activation
```

If the branch already exists locally:

```bash
git switch urgent/custom-domain-activation
git pull --ff-only
```

Do not merge or push this branch to `main` until the Cloudflare and Coolify values are ready. A `main` update triggers the production deployment pipeline.

## What is already implemented

- Native Cloudflare Custom Hostnames API client: create, get/poll, delete contract.
- Runtime validation of the provider fields Tokophi consumes.
- Tokophi TXT ownership verification remains mandatory.
- Upstream CNAME-chain validation remains mandatory; a hostname without a CNAME to `cname.tokophi.cc` cannot advance.
- Provider registration occurs only after both Tokophi checks pass.
- Provider ID and SSL status are persisted.
- A five-minute secured `cron-domains` poller performs the final activation.
- The domain becomes `active` only when both Cloudflare hostname and SSL statuses are active.
- Seller UI supports honest retry and prevents orphaning a provider-attached hostname.
- Super Admin cron liveness includes domain activation.
- The storefront's first-label fallback is restricted to `.sslip.io`, so the new catch-all cannot bypass active custom-domain lookup.
- `ops/tokophi-custom-domains.yaml` provides the priority-0 Traefik route to `tokophi-stores@docker`.

## Evidence already completed

After merging the latest `origin/main`:

```text
Focused tests: 32 passed
Admin production build: passed
TypeScript: passed
Feature branch: 0 commits behind origin/main
```

Earlier full gate on the feature change:

```text
npm test: 556 passed, 52 DB-coupled skipped
Storefront Astro check: 0 errors
Landing Astro check: 0 errors
```

The skipped suites require a real test `DATABASE_URL`; they were not reported as passed.

## Production facts measured before stopping

- Normal public probe was healthy:
  - `tokophi.com` → 200
  - `app.tokophi.com/login` → 200
  - `rich.tokophi.com` → 307
  - `toko.tokophi.com` → 200
  - `batik-nusantara.tokophi.id` → 200
  - public ongkir area search → 200 with rows
- `cname.tokophi.cc` currently returns `503 no available server`.
- The same 503 occurs when the origin IP is requested directly with `cname.tokophi.cc` as Host/SNI.
- Production Traefik has no custom-domain router; unmatched hosts reach Coolify's empty `noop` service.
- The running admin container currently has neither `CF_SAAS_ZONE_ID` nor `CF_SAAS_API_TOKEN`.
- No Cloudflare, Coolify, Traefik, or production database mutation was performed.

## Task checklist for the Mac session

### Cloudflare

- [ ] Open the `tokophi.cc` zone.
- [ ] Confirm Cloudflare for SaaS is enabled.
- [ ] Confirm fallback origin `cname.tokophi.cc` exists.
- [ ] Create a dedicated API token named `tokophi-custom-hostnames`.
- [ ] Grant only **Zone → SSL and Certificates → Edit**.
- [ ] Restrict it to the specific `tokophi.cc` zone.
- [ ] Copy the `tokophi.cc` Zone ID.
- [ ] Never paste the token into chat, Git, docs, screenshots, or shell history.

Official references:

- https://developers.cloudflare.com/api/resources/custom_hostnames/methods/create/
- https://developers.cloudflare.com/api/resources/custom_hostnames/methods/get/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/create-custom-hostnames/

### Coolify

- [ ] Set these environment variables on the Tokophi resource:

```env
CF_SAAS_ZONE_ID=<tokophi.cc Zone ID>
CF_SAAS_API_TOKEN=<dedicated token>
CUSTOM_DOMAIN_CNAME_TARGET=cname.tokophi.cc
```

- [ ] Save the environment without exposing values.
- [ ] Confirm the source branch/commit intended for deployment.
- [ ] Deploy only with explicit production approval.
- [ ] Verify the running admin environment reports the two Cloudflare variables as present, never their values.

### Traefik origin route

After the application deployment is healthy:

```bash
scp ops/tokophi-custom-domains.yaml tokophi-vps:/data/coolify/proxy/dynamic/tokophi-custom-domains.yaml
```

- [ ] Confirm Traefik hot-reloads the file.
- [ ] Keep router priority at `0`.
- [ ] Do not alter the existing `.com`/`.id` routers at priority `1+`.
- [ ] Confirm `cname.tokophi.cc` no longer falls into the priority `-1000` empty service.

### Existing pending merchant domain

- [ ] Record the exact pending hostname before changing anything.
- [ ] Confirm its DNS has a CNAME chain ending at `cname.tokophi.cc`.
- [ ] Confirm the Tokophi TXT ownership record exactly matches the seller UI.
- [ ] Use **Verifikasi** or **Coba lagi** from Pengaturan → Domain.
- [ ] Confirm Cloudflare creates exactly one Custom Hostname.
- [ ] Confirm Tokophi stores the provider ID.
- [ ] Wait for hostname status `active` and SSL status `active`.
- [ ] Confirm Tokophi moves the row to `active`.
- [ ] Promote it to primary only after HTTPS works.

## Done when

- [ ] `https://<merchant-host>/` serves the intended store with a browser-trusted certificate.
- [ ] A product route and category route work on the custom hostname.
- [ ] Canonical and Open Graph URLs name the selected primary host.
- [ ] The system storefront redirects to the custom primary for GET/HEAD HTML routes.
- [ ] `/api/*` is not redirected.
- [ ] `app.tokophi.com`, `rich.tokophi.com`, `tokophi.com`, and `<slug>.tokophi.id` still reach their original surfaces.
- [ ] Super Admin → Analitik → Sistem shows `cron-domains` healthy.
- [ ] Seller activation produces no relevant browser console or failed-network errors.
- [ ] The external production probe remains green.

## Rollback

If the catch-all hijacks or breaks a named surface, remove only:

```text
/data/coolify/proxy/dynamic/tokophi-custom-domains.yaml
```

Keep the affected domain out of `active`. Revoke the dedicated token if exposure is suspected. Do not delete a Cloudflare provider hostname without reconciling its `store_domains.provider_id` row.

## Related records

- `2026-08-07-custom-domain-analysis-worklog.md` — analysis, root cause, implementation, and evidence.
- `2026-08-07-urgent-custom-domain-activation.md` — original urgent execution task.
- `CUSTOM_DOMAIN.md` — current architecture and domain contract.
