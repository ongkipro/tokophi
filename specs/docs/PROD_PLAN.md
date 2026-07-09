# TokoΦ — Production, Scaling & Security Plan (discussion summary)

> Ringkasan keputusan arsitektur untuk go-live. Skala awal: **50–100 client (toko) · 10–30rb visitor
> ad-driven**. Companion: `SYSTEM_GUIDE.md` (sistem), `UML.md` §8 (diagram deploy/scaling), ADR 0007/0008.
> Status: **DISKUSI — belum diimplementasi**. Yang dev-lokal (cache) sudah jalan.

---

## 1. Stack — usulan vs keadaan

| Layer | Target | Sekarang | Verdict |
|---|---|---|---|
| Storefront | Astro/Next | **Astro 5 (SSG)** | ✅ (akan → SSR, lihat §5) |
| Admin / Super-admin | Next + shadcn | **Next 16 + shadcn/Base UI** | ✅ multi-tenant, 1 deploy each |
| DB | PostgreSQL | **PostgreSQL 16 (RLS)** | ✅ |
| ORM | Drizzle/Prisma | **Drizzle** (55 tabel) | ✅ |
| Backend | Nest/Hono/Fastify | **tidak ada** — Next server actions + `/api/public/*` | ⚠️ beda filosofi — **cukup** untuk skala ini |
| Cache | Redis | **in-proc TTL** (`@tokophi/lib/cache`) | → prod **Workers KV** (bukan Redis) |
| Queue | BullMQ/Inngest | tidak ada | ⚠️ perlu untuk async reliable |
| Storage | R2/S3 | `public/uploads` lokal | → **R2 + Cloudflare Images** |
| Hosting | VPS + Coolify | lokal Docker | ✅ searah (self-host, bukan Supabase) |

---

## 2. Scaling (50–100 client / 10–30rb ad)

**Analisa beban** — yang berat BUKAN page view (statis+CDN gampang), tapi:
- 🔴 **Gambar produk** — 10–30rb view × ~5 = **100rb+ req/hari** → dari `public/` lokal = choke.
- 🔴 **Cek Ongkir** — cek ~5–10× lebih sering dari beli → **1rb–9rb call KiriminAja/hari** (live + rate-limited).
- 🟡 Order/payment/shipment — 100–900/hari (konversi 1–3%) → DB write kecil, tapi harus reliable.
- 🟢 DB, admin, page view — ringan.

**Prioritas WAJIB sebelum ads:**
1. **R2 + Cloudflare Images** (gambar produk).
2. **Cache `shipping_price` → Workers KV** (hindari 429 KiriminAja). *Pola sudah dibangun lokal:* `@tokophi/lib/cache` (TTL 10 mnt) — swap ke KV di prod.
3. **DB connection pooling** (PgBouncer / Hyperdrive) untuk burst campaign.
4. **Queue** (CF Queues / Inngest): callback bayar, dispatch shipment, tracking, notif WA/email, abandoned-cart.

**Ditunda / opsional:** backend khusus (Hono) — hanya kalau API dipakai mobile/eksternal; Redis penuh — hanya kalau BullMQ (kalau KV cukup, skip).

---

## 3. Cache — Redis vs Cloudflare KV
Redis **berguna** (cache tarif, rate-limit, backing BullMQ) — koreksi dari "tak perlu". TAPI karena **Cloudflare = host utama**, use-case ini pindah ke **Workers KV / Cache API** (edge, murah, tanpa server). → **Default KV**; Redis hanya jika pakai BullMQ.

---

## 4. Storage & gambar (CF-native)
1. Admin upload → **R2** (bukan disk); `product_media.url` = key R2.
2. Storefront render via **Cloudflare Images / Image Resizing**: 1 asli di R2 → `?width=…&format=auto` → WebP/AVIF responsif dari edge, egress gratis, zero origin load.
→ Sekaligus menyelesaikan item **Storage (R2/S3)**.

---

## 5. Domain & storefront (KEPUTUSAN)

**Zona hub = 1 domain: `tokophi.com`** (di Cloudflare):
```
tokophi.com                       → Landing/marketing (SaaS)
app.tokophi.com                   → Merchant admin (Shopify-style: 1 deploy, multi-tenant)
rich.tokophi.com                  → Super admin (internal)
*.tokophi.com                     → Storefront default subdomain (opsi)
cname.tokophi.com                 → target CNAME custom domain + fallback origin (CF for SaaS)
```

- **Admin = `app.tokophi.com`** (dikonfirmasi user; gaya Shopify `admin.shopify.com/store/{id}/`). Store-context bisa lewat **path `/store/{slug}/`** (berguna untuk super-admin deep-link/impersonation & merchant multi-toko) — **keputusan terbuka** (default sekarang: scope by session, tanpa path).
- **Custom domain merchant** (user beli + CNAME sendiri) → `cname.tokophi.com` → **Cloudflare for SaaS** terbitkan SSL otomatis.
- **Storefront WAJIB SSR multi-tenant** (bukan SSG per-client) — resolve toko dari `Host` header → 1 deploy layani semua toko + custom domain. Update **ADR 0008**.
- Butuh mapping DB: `stores.custom_domain` (atau tabel `store_domains` many-to-one). **Dev-lokal:** resolve via `Host` / `?store=slug`.

**Impersonation lintas-subdomain** (rich→app): cookie beda subdomain → pakai **one-time token signed + short-lived** redirect (bukan set cookie langsung).

---

## 6. VPS + Coolify + Docker

```
Cloudflare (edge): CDN/cache · R2+Images · KV · CF for SaaS (SSL custom domain) · Queue
        │ proxy
VPS (Coolify/Docker): app + rich + storefront-SSR + PgBouncer + Postgres 16 (+opsi Redis/MinIO)
```
- **Storefront SSR di VPS** (bukan Workers) → akses Postgres langsung (tanpa Hyperdrive), lebih simpel; CF di depan untuk cache + custom domain.
- **Coolify** urus: git-push deploy 3 app, Postgres + backup, SSL (Let's Encrypt) app./rich., env, logs, restart.
- **Sizing awal: 1 VPS** 4 vCPU / 8–16 GB / NVMe (beban berat sudah di-offload ke CF). Pisah Postgres saat jadi hotspot.
- **Backup DB** terjadwal (Coolify) → **R2**.

---

## 7. Security

**✅ Sudah kuat:** RLS (isolasi tenant), RBAC (`requireCapability`), JWT (jose) + scrypt, secrets gitignored (keys tak di git), Drizzle parameterized, React escaping.

**🔴 KRITIS — sebelum prod:**
- ~~Payment callback tanpa verifikasi~~ → **✅ DIPERBAIKI (db4f3af):** guard **shared-secret** (`AUTOLARIS_CALLBACK_SECRET`, konstan-waktu, via header `X-Callback-Token`/`?token=`) + rate-limit per-IP + **idempotent** (skip yang sudah `berhasil`). **Sisa (prod):** ganti shared-secret → **HMAC signature asli** begitu spec AutoLaris dikonfirmasi + IP whitelist.

**🟠 PENTING — sebelum ads:**
- ~~Endpoint publik tanpa rate-limit~~ → **✅ DIPERBAIKI (db4f3af):** rate-limit per-IP (`@tokophi/lib` `rateLimit`, cf-connecting-ip) — ongkir 60/mnt, pay 20/mnt, order 10/mnt, callback 60/mnt → 429. **Sisa (prod):** swap in-proc → **Workers KV** (biar lintas-instance), + **Turnstile** + **CORS ketat** (kini masih `*`).

**🟡 Checklist deploy:** ganti `AUTH_SECRET` (fallback `dev-insecure-…`) + password `tokophi123`; cookie `Secure`; HTTPS; CF WAF/DDoS; rotasi key prod (bukan sandbox).

**Security "engine" (arah):** berlapis — (1) **Cloudflare edge** WAF/DDoS/rate-limit/Turnstile · (2) **app `guard()` custom tipis**: auth(jose)→rbac(matrix/Casbin)→rate-limit(KV/upstash)→validasi(zod)→webhook-signature(HMAC)→idempotency→audit · (3) **DB RLS**. Prinsip: **jangan bikin crypto/WAF/algoritma sendiri**; orkestrasi custom di atas primitif teruji. Referensi: Arcjet, Casbin, upstash/ratelimit, Svix.

---

## 8. Decision log

**✅ Diputuskan:**
- Hosting serius = **VPS + Coolify + Docker**, self-hosted Postgres (bukan Supabase).
- Cloudflare-native untuk edge/cache/storage/domain.
- `tokophi.com` = zona hub; **`app.tokophi.com`** (admin) + **`rich.tokophi.com`** (super-admin).
- Custom domain merchant via **CNAME → `cname.tokophi.com` + Cloudflare for SaaS**; user kelola beli+CNAME.
- Storefront → **SSR multi-tenant** (resolve by hostname).
- Cache = **Workers KV** (bukan Redis) kecuali BullMQ.
- Security engine = **hybrid** (edge + `guard()` custom + RLS), bukan crypto from scratch.

**✅ Store-context admin = path `/store/{slug}/`** (Shopify-style, dikonfirmasi & jalan):
- **Step 1** (3692bb4): middleware rewrite `/store/{slug}/{rest}` → route internal + header; non-breaking (URL lama tetap jalan); scope tetap dari session (RLS).
- **Step 2** (74f7e01): `getStoreSlug` + `useStoreHref`/StoreProvider slug; nav link prefixed + active-state strip-prefix.
- **Step 3** (db978f3): post-login redirect ke `/store/{slug}` + super-admin impersonation **deep-link** ke `ADMIN_URL/store/{slug}`. **Store-path COMPLETE + verified (nol crash).**
- ⏳ Sisa (untuk 1-akun-banyak-toko): validasi `slug↔membership` + store-switcher UI.

**⏳ Terbuka (perlu diputuskan):**
1. Queue: **CF Queues** vs **Inngest** vs **BullMQ+Redis**?
3. RBAC: tetap **matrix** atau pindah **Casbin**?
4. App-layer security: **`guard()` custom** vs **Arcjet**?
5. Nama target CNAME: `cname.tokophi.com`?
6. Spec **signature callback AutoLaris** — konfirmasi ke vendor.

**Urutan implementasi disarankan (saat mulai prod):**
① ~~Callback signature + rate-limit~~ **✅ interim done (db4f3af)** — sisa: HMAC asli + KV + Turnstile → ② R2 + CF Images (gambar) → ③ Storefront SSR + hostname resolve + domain mapping → ④ DB pooling → ⑤ Queue → ⑥ Coolify deploy (Dockerfile per app).
