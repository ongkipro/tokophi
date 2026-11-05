# INF-TOKOPHI-VPS — Dedicated host bootstrap

> **Status: DONE — cutover 2026-11-01 18:53 UTC.** Production runs on this host. Current runbook: `specs/docs/DEPLOY.md`. This file is the bootstrap history.

## Authorization and boundary

- Owner approved a new Singapore `vhp-2c-4gb-amd` instance ($24/month base price), Ubuntu 24.04 and server/SSH configuration.
- Existing production host, DNS, deployments and databases must remain untouched.
- Infrastructure identifiers and SSH connection details belong in device-local records, not this repository.
- Redacted for the public repository (2026-11-06, DEC-009): the host's public IP, the Coolify resource UUID (`<app-uuid>`; the watchdog reads it from `TOKOPHI_APP_UUID`), the Coolify hostname, the SSH key fingerprint, the token name, local tunnel ports and live order numbers. Originals live in the owner's device-local ops notes.

## Execution

- 2026-11-01 15:59 UTC — Main Session — API authentication verified after the owner allowlisted the workstation IP. OS catalog confirms Ubuntu 24.04 LTS x64 ID 2284. Existing account instance inventory inspected without exposing generated passwords.
- 2026-11-01 16:02 UTC — Main Session — First dedicated instance verified by API, TCP 22 and SSH key login, then deleted at the owner's request because its assigned public IP was unwanted. Existing account hosts were not modified.
- 2026-11-01 16:07 UTC — Main Session — Replacement Singapore `vhp-2c-4gb-amd` Ubuntu 24.04 instance reached `running` / `ok`; SSH key authentication succeeded and cloud-init reported `done`. ICMP from the owner workstation, allowed only from that `/32`, measured 4/4 replies, 0% loss, average 33.356 ms after the provider firewall rule propagated.
- 2026-11-01 16:14 UTC / Main Session / Base host optimization completed: key-only `ongki` sudo user added; SSH now rejects passwords and keyboard-interactive logins, keeps root key-only, sets `MaxAuthTries 3` and disables X11 forwarding. `fail2ban` sshd jail is active; ICMP and TCP 22 are limited to the owner workstation `/32` at the Vultr firewall. Swappiness is 10, VFS cache pressure is 50, and journald is capped at 500 MB / 14 days. Full package upgrade completed and the empty host was rebooted onto kernel `6.8.0-147-generic`.
- Verification after reboot: key login for `ongki` and root succeeded; root password-only attempt returned `Permission denied (publickey)`; `ssh`, `fail2ban` and `unattended-upgrades` were active; 0 upgradable packages and no reboot marker; 4/4 ping replies, 0% loss, average 33.368 ms. UFW `limit` was tested and removed after it blocked automation bursts, because the provider firewall already restricts SSH to one source IP.
- 2026-11-01 16:22 UTC / Main Session / Coolify v4.5.3 installed from the official installer (downloaded script SHA-256 `7ef7ff6e5ee4738025d5003cacfca4fcc36df0a8844cc324f6ebb4a20b2dff04`) with Docker Engine v29.9.2. `coolify`, `coolify-db` and `coolify-redis` were healthy. Docker daemon json-file log rotation is `10m x 3`; inotify limits and `somaxconn=4096` are set. Provider firewall blocks 8000, 6001 and 6002 from the owner workstation; dashboard access uses an SSH tunnel on the workstation (local port, device-local notes) and returned `302 /login` and `200 /register`. Public 80 returned 503 with no app routed. Coolify source `.env` was backed up off-host with mode 600 and matching SHA-256.
- 2026-11-01 16:27 UTC / Main Session / Tailscale was installed for Mac dashboard access, then removed at the owner's request before the node joined a tailnet: logout attempted, `tailscaled` disabled, package and apt source removed, `/var/lib/tailscale` deleted. Verified no `tailscale` binary, unit file or interface remained; all Coolify containers stayed healthy.
- 2026-11-01 16:27 UTC / Main Session / Mac shares the allowlisted public IP. A Mac-only key ((fingerprint in the device-local ops notes)) was authorized for the `ongki` account; Mac SSH config was backed up before adding `tokophi-new-ops` and the tunnel alias `tokophi-coolify`. Mac login returned host `tokophi` and user `ongki`. The workstation tunnel was stopped, `coolify` restarted healthy, and the Mac tunnel returned 200 for `/register`.
- 2026-11-01 16:30 UTC / Main Session / Owner registration verified from Coolify data: exactly one user, id 0, owner of team 0; registration is off. Through the Mac tunnel `/register` now redirects to `/login`, and `/login` returns 200.
- 2026-11-01 16:40 UTC / Main Session / GitHub App `tokophi-ongkipro` was created in Coolify, but GitHub's install callback reached closed public port 8000 with `setup_action=update`. Coolify's update branch only looks up an existing installation, so it could not save the first installation id. Verified the installation through the GitHub App API (HTTP 200, same app id, account `ongkipro`, selected repositories), then saved its installation id. Installation token request returned 201 and repository listing returned 200 with `ongkipro/tokophi` and `ongkipro/tokophidoc`.
- Status: Coolify installed, owner secured, GitHub source connected for manual deploys. Webhook auto-deploy needs a public HTTPS Coolify URL. Domains, migrations and deploys have not been run.
- 2026-11-01 18:12 UTC / Main Session / Workstation public IP changed; Vultr firewall gained TCP 22 + ICMP rules for the new owner `/32` (old `/32` rules left in place). Cloudflare DNS for a second Coolify hostname (A → dedicated host, proxied (zone SSL `strict`, Always HTTPS on). Cloudflare Origin CA ECC certificate issued for `tokophi.com`, `tokophi.id`, `tokophi.cc` and their wildcards (expires 2041-10-28); private key generated on the host and never left it; cert/key public-key hashes match; loaded by Traefik through a dynamic TLS file. Coolify instance FQDN set to that hostname and proxy config regenerated . Verified: that hostname → 302 `/login`, `/login` → 200, HTTP → 301 HTTPS. 
- 2026-11-01 18:20 UTC / Main Session / Reverted at the owner's direction: the Coolify host is the existing Access-protected hostname (device-local notes). The second hostname had exposed the Coolify login without Access, so its DNS record was deleted (the name now falls through to `*.tokophi.com`, the existing production host) and the instance FQDN was set back to the Access-protected hostname with proxy config regenerated. Verified its `/login` 302s to the Cloudflare Access login. The multi-domain Origin CA certificate stays loaded for the later app routes; the earlier Coolify-hostname certificate stays too. Production DNS records (apex, `www`, `app`, `rich`, `toko`, `*.tokophi.com`, `tokophi.id`, `*.tokophi.id`, `cname.tokophi.cc`) still point at the existing production host, unchanged.
- 2026-11-01 18:35 UTC / Main Session / Coolify API enabled on the dedicated host and one API token (abilities read/write/deploy, team 0) minted server-side and stored only in the workstation `secrets-env` (`COOLIFY_TOKOPHI_URL` / `COOLIFY_TOKOPHI_TOKEN`); its value was never printed. API access stays behind SSH, not through Cloudflare Access: workstation SSH alias `tokophi-coolify` forwards a local port to the Coolify port on the host, wrapper `~/.local/bin/tokophi-coolify` opens it on demand, and the `coolify` CLI gained context `tokophi` (not default). Verified: `/api/v1/version` → `4.5.3`; servers → `localhost` reachable; projects → empty; `coolify --context tokophi server list` → 1 server; `secrets-env check` OK.

## Deploy record — TokoΦ on the dedicated host (2026-11-01)

Live origin for every TokoΦ hostname since 2026-11-01 18:53 UTC: `<dedicated-host-ip>` (Vultr `sgp`, `vhp-2c-4gb-amd`, Ubuntu 24.04, Coolify 4.5.3, Traefik 3.7). This section is the runbook for this host.

### Coolify resource

- Project `Tokophi`, application `tokophi`, uuid `<app-uuid>`. Source: GitHub App `tokophi-ongkipro` → `ongkipro/tokophi`, branch `main`, build pack **Docker Compose**, compose file **`/docker-compose.coolify.yml`** (not `/docker-compose.yml`, which is the local dev DB only), base directory `/`.
- `application_settings.is_consistent_container_name_enabled = true` (containers are `<service>-<app-uuid>`; unchanged services are not recreated on deploy).
- Service domains (`docker_compose_domains`): `admin` → `https://app.tokophi.com`, `super-admin` → `https://rich.tokophi.com`, `storefront` → `https://toko.tokophi.com`, `landing` → `https://tokophi.com`. `docs` (`panduan.tokophi.com`) routes by its own compose label. Set via the API with `force_domain_override: true`.
- Environment: 33 keys, the full set the compose forwards (`AUTH_SECRET`, `INTEGRATION_TOKEN_KEY`, provider keys, `CRON_SECRET`, `CF_SAAS_*`, `R2_*`, cross-surface URLs = `https://app.tokophi.com…`, `STOREFRONT_BASE_DOMAIN=tokophi.id`, `STORE_SLUG=batiknusantara`, `SIGNUP_ENABLED=true`, `KIRIMINAJA_ENV=sandbox`). Values verified against the source set by SHA-256 per key (33/33 match); never printed. `INTEGRATION_TOKEN_KEY` and `AUTH_SECRET` are unchanged so encrypted provider/CAPI tokens and sessions stay valid.
- Deploy: Coolify UI, or `tokophi-coolify "/api/v1/deploy?uuid=<app-uuid>" -X POST` from the workstation. GitHub push webhooks cannot reach Coolify through Cloudflare Access yet (needs an Access bypass for `/webhooks/source/github/events`).

### Database

- Restored from the 2026-10-27 06:25 UTC `pg_dump` (`pg_restore --exit-on-error`, clean): 17 stores, 227 orders, 116 migrations; `migrate` on first deploy applied nothing new.
- Roles: `tokophi` (bootstrap/owner, new password), `tokophi_app` (login, nosuperuser, **no** bypassrls), `tokophi_platform` (login, nosuperuser, bypassrls). All three passwords freshly generated; `POSTGRES_PASSWORD`, `APP_DATABASE_URL`, `PLATFORM_DATABASE_URL` carry them. Measured after deploy: connections as `tokophi_platform` ×6, `tokophi_app` ×1, `tokophi` ×1 (backup sidecar).
- ⚠️ Any order or payment made after that dump and before cutover is not in this database.

### Uploads

- Volume `<app-uuid>_tokophi-uploads` pre-filled before first deploy: 578 files, 37.5 MB. Verified `https://app.tokophi.com/api/uploads/<file>.webp` → 200 `image/webp`.

### Proxy (`/data/coolify/proxy/dynamic/`)

- `tokophi-origin-cert.yaml` → Cloudflare Origin CA ECC cert for `tokophi.com`, `tokophi.id`, `tokophi.cc` + wildcards (`certs/tokophi-origin.{pem,key}`, exp 2041-10-28).
- From `ops/` on `main`: `tokophi-stores-id.yaml`, `tokophi-com-to-id-redirect.yaml`, `tokophi-id-platform-redirect.yaml`, `tokophi-www-apex-redirect.yaml`, `tokophi-custom-domains.yaml`.
- 🔴 **`tokophi-custom-domains.yaml` runs at `priority: -1` on this host, not `0` as in the repo.** At `0` its `HostRegexp(^.+$)` catch-all outranked every `ops/` redirect router (Traefik 3.7 resolved the tie against them): `app.tokophi.id`, `tokophi.id`, `<slug>.tokophi.com` all served the storefront 404 instead of redirecting. At `-1` (still above Coolify's `-1000` default) every redirect works and unknown hosts still reach the storefront. The repo file must be changed to match.
- Not installed here yet: `retry-global` (entrypoint middleware + static arg). Proxy logs show transient `service tokophi-stores@docker does not exist` / `gzip@docker does not exist` lines only while containers start; none after.

### DNS (Cloudflare, all proxied)

| Zone | Records → `<dedicated-host-ip>` | SSL mode |
|---|---|---|
| `tokophi.com` | `@`, `www`, `app`, `rich`, `toko`, `*`, the Coolify hostname (behind Access) | strict |
| `tokophi.id` | `@`, `*` | strict |
| `tokophi.cc` | `cname` (Cloudflare-for-SaaS fallback origin) | full |

### Verified through Cloudflare after cutover (2026-11-01 18:53 UTC)

`app.tokophi.com/login` 200 · `rich.tokophi.com/login` 200 · `toko.tokophi.com` 200 · `tokophi.com` 200 · `panduan.tokophi.com` 200 · `batiknusantara.tokophi.id` 200 (product images load from `app.tokophi.com/api/uploads/`) · `www.tokophi.com/fitur/` 301 → apex · `batiknusantara.tokophi.com` 301 → `.tokophi.id` · `app.tokophi.id` 301 → `app.tokophi.com` · `tokophi.id` 301 → `tokophi.com` · Coolify hostname → Cloudflare Access login. All 16 containers healthy; `migrate` and `seed` exited 0; `backup-offsite` reported `offsite-ok`.

### Open after cutover

- 🔴 **KiriminAja rejects this host's IP** (`Your IP address <dedicated-host-ip> were not allowed to access this API`, HTTP 401). The first `cron-tracking` tick flagged 3 live orders as permanent courier rejections; `problem_at`/`problem_note` were reset to their pre-cutover value (NULL, confirmed against the dump) and **`cron-tracking` is stopped with restart policy `no`** until the IP is whitelisted. Quotes, bookings and cancels from Seller/checkout will also fail until then. After whitelisting: `docker update --restart=unless-stopped cron-tracking-<app-uuid> && docker start …` (or redeploy).
- Confirm the AutoLaris callback / IP allowlist (if any) for the new egress IP `<dedicated-host-ip>`.
- Change `ops/tokophi-custom-domains.yaml` to `priority: -1` in the repo.
- Install `retry-global` and an Access bypass for the GitHub webhook path.

### Follow-up status (re-checked 2026-11-06 against BUILD-LOG and the repo)

- ✅ KiriminAja allow-list: owner whitelisted the new IP; rates verified live and `cron-tracking` restarted `unless-stopped` 2026-11-02 (BUILD-LOG 2026-11-02, owner go "ya jalankan").
- ✅ `ops/tokophi-custom-domains.yaml` is `priority: -1` in the repo.
- 🔴 Still open: GitHub push webhook cannot reach Coolify through Cloudflare Access, so every merge needs a MANUAL deploy (`specs/docs/DEPLOY.md` step 2).
- ❔ Not re-verified: `retry-global` on this host's proxy, and whether AutoLaris needs the new egress IP allow-listed.
