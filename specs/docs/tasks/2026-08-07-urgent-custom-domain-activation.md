# URGENT — Activate Cloudflare for SaaS custom domains

**Priority:** P0
**Owner:** Ongki (Cloudflare and Coolify dashboard access)
**Execution device:** Mac laptop
**Status:** Ready after this workstation's source changes are committed and pushed

## Problem

Merchant domain setup cannot complete in production:

- `https://cname.tokophi.cc/` returns `503 no available server`.
- `/data/coolify/proxy/dynamic/` has no custom-domain router, so forwarded merchant hosts fall into Coolify's empty `noop` service.
- The running admin container has neither `CF_SAAS_ZONE_ID` nor `CF_SAAS_API_TOKEN`.
- A seller can prove TXT ownership, but the domain remains `provisioning` because no production credential can create or poll a Cloudflare Custom Hostname.

Public platform surfaces were healthy during diagnosis on 2026-08-07: landing `200`, seller login `200`, super-admin `307`, demo storefront `200`, and `batik-nusantara.tokophi.id` `200`.

## Source change set prepared on the Linux workstation

Review and commit the custom-domain changes before pulling them on the laptop:

- `apps/admin/lib/cloudflare-saas.ts` — create/get/delete Custom Hostnames using the Cloudflare API.
- `apps/admin/lib/cloudflare-saas.test.ts` — activation-state and request-contract tests.
- `apps/admin/lib/actions/domain.ts` — register the hostname after Tokophi TXT ownership passes.
- `apps/admin/app/api/cron/domains/route.ts` — poll hostname and certificate state.
- `apps/admin/components/admin/pengaturan/domain-card.tsx` — honest retry and activation states.
- `apps/admin/lib/data/domain.ts` — expose whether a provider hostname is attached.
- `apps/storefront/src/data/store.ts` — prevent arbitrary hosts from bypassing the active-domain lookup.
- `ops/tokophi-custom-domains.yaml` — priority-0 Traefik router to `tokophi-stores@docker`.
- `docker-compose.coolify.yml` — Cloudflare env forwarding and five-minute domain poller.
- Environment health/examples and Super Admin cron-liveness files.

Do not include unrelated local changes in the commit.

## Cloudflare setup on the Mac

1. Open Cloudflare Dashboard → **My Profile → API Tokens**.
2. Create a dedicated token named `tokophi-custom-hostnames`.
3. Grant only **Zone → SSL and Certificates → Edit**.
4. Limit the resource to the specific `tokophi.cc` zone.
5. Copy the token once; never paste it into chat, source control, task files, or shell history.
6. Open the `tokophi.cc` zone Overview and copy its **Zone ID**.
7. Confirm Cloudflare for SaaS remains enabled and fallback origin `cname.tokophi.cc` exists.

Official references:

- https://developers.cloudflare.com/api/resources/custom_hostnames/methods/create/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/create-custom-hostnames/

## Coolify setup on the Mac

In the Tokophi resource's Environment Variables, set:

```env
CF_SAAS_ZONE_ID=<tokophi.cc Zone ID>
CF_SAAS_API_TOKEN=<dedicated token>
CUSTOM_DOMAIN_CNAME_TARGET=cname.tokophi.cc
```

Save the variables, then deploy only after the source change set is on the remote branch. Never store the values in `.env.example`, docs, Git, or screenshots.

## Origin router

After the deployment is healthy, copy the committed router to the VPS:

```bash
scp ops/tokophi-custom-domains.yaml tokophi-vps:/data/coolify/proxy/dynamic/tokophi-custom-domains.yaml
```

Traefik watches this directory and should hot-reload it. The router must stay at priority `0`: below the `.com`/`.id` storefront routers at priority `1`, above Coolify's default `noop` router at `-1000`.

## End-to-end activation

1. Record the pending merchant hostname in Pengaturan → Domain.
2. Confirm its DNS contains:
   - `CNAME <merchant host> → cname.tokophi.cc`
   - the Tokophi ownership TXT value shown by the seller dashboard.
3. Click **Verifikasi** or **Coba lagi**.
4. Confirm Tokophi stores a Cloudflare provider ID and remains `provisioning` until both provider states are active.
5. Wait for the five-minute `cron-domains` poller or call the secured cron route once.
6. Make the domain primary from the seller dashboard after it becomes `active`.

## Done when

- The running admin environment reports both `CF_SAAS_ZONE_ID` and `CF_SAAS_API_TOKEN` as present without exposing their values.
- Cloudflare Custom Hostnames contains the exact merchant hostname.
- Cloudflare hostname status is `active` and SSL status is `active`.
- `https://<merchant-host>/` returns the intended store with a browser-trusted certificate.
- Product and category routes work on the custom hostname.
- The system domain redirects to the custom primary while `/api/*` requests are not redirected.
- `app.tokophi.com`, `rich.tokophi.com`, `tokophi.com`, and `<slug>.tokophi.id` still resolve to their original surfaces.
- `cron-domains` appears healthy in Super Admin → Analitik → Sistem.
- Browser console shows no relevant error during the seller activation flow.

## Verification already completed locally

- `npm test`: 556 passed; 52 DB-coupled tests skipped because no local `DATABASE_URL` was available.
- Admin production build with a documented dummy build-time `DATABASE_URL`: passed.
- Storefront Astro check: 0 errors.
- Landing Astro check: 0 errors.

## Rollback

If routing regresses, remove only `/data/coolify/proxy/dynamic/tokophi-custom-domains.yaml`; the existing named routers remain untouched. Keep affected database rows out of `active`, revoke the dedicated Cloudflare token if exposure is suspected, and do not delete a provider hostname without also reconciling its `store_domains.provider_id` row.
