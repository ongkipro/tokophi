# Privacy & compliance engineering

> 🟡 **DRAFT FOR OWNER APPROVAL — NOT LEGAL ADVICE, NOT REVIEWED, NOT PUBLISHED.**
> Written 2026-11-14 (BUYER-ACCOUNT-DEPLOY) as the engineering input the owner and qualified Indonesian
> counsel need under **UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP)**. Every role
> label below ("controller", "processor") is a **proposed reading for review**, not a legal
> determination. Nothing in this file is rendered on any production page; the storefront wording in §3
> lives here only, on purpose, until the owner approves it.
>
> - What the platform does with personal data TODAY is recorded where it is enforced: `SECURITY.md`
>   (trust boundaries, encryption at rest, what is logged), the abandoned-cart rules in `AGENTS.md`,
>   `REQUIREMENTS.md` §2.9. If this draft disagrees with the code, the code wins and this is the bug.
> - A broader, also UNREVIEWED platform inventory (148 lines: hosting transfer to Singapore, every
>   provider, retention table, rights workflows) exists on the unmerged branch
>   `feature/buyer-account-local`, commit `8dc12d7`. It was not merged because nobody has reviewed it.
> - **ADR 0016 "Production enablement" item (1)** is this file: the buyer account must not be switched
>   on before the owner approves §1 and §3A.

## 1. Akun TokoΦ — TokoΦ as controller of the buyer-account data (DRAFT)

**Proposed reading for review:** the buyer account (`apps/account`, `account.tokophi.com`, ADR 0016) is
TokoΦ's own service, offered to shoppers across every store. TokoΦ decides what is collected and why, so
TokoΦ — not the merchant — is proposed as the **controller** of the account layer. The **store layer**
(the order, the customer row, payment, shipping) stays the merchant's record exactly as it is without an
account; an account only *links* to it, with the buyer's consent, one order at a time.

### 1.1 What is collected — from the code, not from intent

| Data | Source | Stored in | Purpose |
|---|---|---|---|
| Google account id (`sub`), email, display name | Google sign-in (scope `openid email profile`; only a **verified** email is accepted) | `buyer_accounts.google_sub` / `email` / `name` | sign-in; show who is signed in. No password is ever created or stored. |
| Session: start time, last seen, revoked time, browser user-agent string | each sign-in | `buyer_sessions` | keep the buyer signed in (30 days max); "Perangkat" list so the buyer can sign other devices out |
| Saved orders: order id, store id, time saved | the buyer presses "Simpan pesanan" on a claim link and ticks the consent box | `buyer_order_claims` | show that order (status, items, shipping, receipt) in the account |
| Store link: store id, the store's customer id, consent version (`2026-11-14`), consented / revoked time | same consent step | `buyer_store_links` | show later saved orders of that store; let the buyer "Putus toko" |
| Order content shown in the account | **read**, not copied, from the store's `orders`, `order_line_items`, `payments`, shipping rows | (store layer) | the order hub — only orders the buyer saved, only from stores still linked |

Not collected by the account: phone number, address book, payment instruments, marketing preferences,
location, tracking pixels (account pages load **no third-party script**; `noindex`, `no-store`,
`no-referrer`, `X-Frame-Options: DENY` on every response).

### 1.2 Recipients

- **Google** — receives the sign-in request and returns the profile above (Google OAuth, the same client
  the Seller panel uses, its own redirect URI).
- **The merchant** — sees **that** an order of its own store was saved to an Akun TokoΦ and the link
  status (Pelanggan → Akun Pembeli). It never sees the account's email, devices, or any other store's
  orders (RLS: `buyer_accounts` / `buyer_sessions` have RLS on with no policy for the Seller role).
- **Hosting** — the same Vultr (Singapore) origin and Cloudflare proxy as every TokoΦ surface; the
  cross-border question is the platform-wide one recorded on the `8dc12d7` draft, not new here.

### 1.3 Retention and deletion ("Tutup akun")

| Event | What happens (code: `apps/account/src/data/account.ts` `closeAccount`) |
|---|---|
| Buyer closes the account | in one transaction: every session revoked **and its user-agent blanked**; every saved-order row **deleted**; every store link set `revoked`; the account row keeps only an inert marker (`google_sub = closed:<id>`, `email` and `name` set to NULL, `status = closed`). The same Google account can start a new, empty account later. |
| Store layer on closure | **unchanged by design** — orders, customers, payments and the ledger are the merchant's books and must not be corrupted ("two-layer closure", ADR 0016). |
| Buyer disconnects one store ("Putus toko") | link set `revoked`; that store's orders disappear from the account; re-saving an order of that store later re-links it (the consent screen says so). |
| Sessions | valid 30 days; signing out or "keluar dari perangkat lain" revokes the row. Revoked/expired rows are **kept** (device string blanked only on closure) — **no purge job exists**. |

🔴 **Open for the owner / counsel before enablement:**
1. A retention period for revoked and expired `buyer_sessions` rows (ADR 0016 item 5) — none is decided; nothing deletes them today.
2. Whether the closed account's inert row (`id`, `status`, `created_at`) may be kept indefinitely as a tombstone.
3. A privacy notice reachable from `account.tokophi.com` itself (sign-in page): today the sign-in card states only "Dari akun Google, kami hanya menyimpan nama dan email Anda." — there is no linked notice and no contact for data requests.
4. Lawful basis wording for the consent screen (`/klaim`, consent version `2026-11-14`) — the text exists in code; counsel to confirm it is sufficient as consent for the link.

## 2. Plugin Kelola — order and abandoned-cart data shared with kelolatim.com (DRAFT)

**Proposed reading for review:** a store's shoppers are the **merchant's** customers; the merchant is the
controller of their order data, and TokoΦ processes it on the merchant's behalf. When a store **owner**
activates the Kelola plugin (`plugins:manage` is owner-only), TokoΦ sends that store's data to **Kelola
(`kelolatim.com`) as a processor chosen by the merchant**. Whether Kelola is the merchant's processor or
TokoΦ's sub-processor depends on who holds the Kelola contract — KELOLA_PLUGIN_SPEC §7 decision 7
("each merchant brings their own Kelola account, or only stores we onboard?") is still open, and it
decides this label.

### 2.1 What is sent — `specs/docs/KELOLA_PLUGIN_SPEC.md` §3.4, §4.4–§4.9

| Leg | When | Personal data in the payload |
|---|---|---|
| Order (`POST /api/public/toko/order/{token}`) | COD at creation; prepaid only once paid; only while the plugin is **Aktif** and connected | customer name, phone (canonical `62…`), full shipping address (kelurahan, kecamatan, kota, provinsi, kode pos), order number, items, amounts, shipping cost |
| Abandoned checkout / lead (`POST /api/public/toko/lead/{token}`) | **opt-in per store** (`push_leads` default OFF); only sessions that became `ditinggal`, never `aktif`; only with a phone | name and phone (both required by Kelola), whatever address parts the shopper typed (address, kecamatan, kota, provinsi), cart value, product name, the page where they stopped (`kelolaLeadPayload`, `apps/admin/lib/plugins/kelola/wire.ts`) |

Not sent: email, account data (§1 never reaches Kelola), payment instruments, tracking ids. Kelola's own
error text stays Seller-side; the shopper never sees the brand "Kelola".

### 2.2 Stopping and deletion

- **Nonaktifkan**: both legs stop immediately; orders that arrive while off are **never back-filled**.
- **Hapus koneksi**: plugin rows and the credential are deleted on TokoΦ's side.
- Data **already delivered to Kelola stays at Kelola** — deleting it there is between the merchant and
  Kelola. TokoΦ has no way to recall it: Kelola's public API (spec §1–§2) documents push endpoints only — no read, lookup or delete call.

🔴 **Open for the owner / counsel before the plugin is offered to merchants:**
1. A data processing agreement (or terms) with Kelola: purpose limit, security, sub-processors, location,
   retention, deletion on request, breach notice.
2. The connect screen's disclosure text (exists, KELOLA_PLUGIN_SPEC §4.5) — counsel to confirm it.
3. The processor line on each activating store's privacy page — §3B below.

## 3. Storefront privacy-page wording — DRAFT, NOT RENDERED ANYWHERE

The storefront has **no platform-rendered privacy page**: each merchant writes its own under
`/halaman/<slug>` (Seller → Halaman). So these blocks are **text for the owner to approve**, after which
the owner decides how it reaches shoppers (a template the merchant pastes, a Seller-side reminder when
the feature is on, or a platform-rendered block). Shopper-facing copy is Bahasa Indonesia, like the rest
of the storefront. Do not copy any of it into code or a page before approval.

### 3A. Akun TokoΦ (for stores where "Simpan ke Akun TokoΦ" is shown)

> **Akun TokoΦ (opsional).** Setelah checkout, Anda dapat menyimpan pesanan ke Akun TokoΦ, layanan dari
> TokoΦ (penyedia platform toko ini) untuk melihat pesanan Anda dari berbagai toko TokoΦ di satu tempat.
> Belanja tetap bisa tanpa akun. Jika Anda memakainya, TokoΦ menyimpan nama dan email dari akun Google
> Anda, data sesi masuk (waktu dan jenis perangkat/peramban), serta daftar pesanan yang Anda pilih untuk
> disimpan. Toko ini hanya dapat melihat bahwa pesanan dari toko ini tersimpan di Akun TokoΦ; toko tidak
> mendapat akses ke email, perangkat, atau pesanan Anda di toko lain. Anda dapat memutus toko ini atau
> menutup akun kapan saja dari account.tokophi.com; menutup akun menghapus data akun tersebut, sedangkan
> catatan pesanan di toko tetap disimpan toko sebagai bagian dari pembukuannya.

### 3B. Kelola (only for a store that activated the Kelola plugin)

> **Pengelolaan pesanan dan layanan pelanggan.** Untuk memproses pesanan dan menghubungi Anda terkait
> pesanan, toko ini menggunakan layanan pihak ketiga (Kelola, kelolatim.com). Data yang dikirim: nama,
> nomor telepon, alamat pengiriman, dan isi pesanan Anda. [Jika fitur keranjang ditinggal aktif:] Jika
> Anda mengisi nama dan nomor telepon di checkout tetapi tidak menyelesaikan pesanan, data tersebut,
> alamat yang sudah Anda isi, dan isi keranjang juga dapat dikirim agar toko dapat menindaklanjuti.

⚠️ 3B names a brand to the shopper, which KELOLA_PLUGIN_SPEC §4.5 avoids everywhere else ("Kelola" is
shown to the Seller, never to a shopper). Naming a recipient in a privacy notice may be what the law asks
for — that conflict is for the owner and counsel to resolve, not for engineering.
