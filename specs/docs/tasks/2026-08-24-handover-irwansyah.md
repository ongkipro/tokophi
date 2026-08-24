# Handover — 2026-08-24 session close (for Irwansyah / next collaborator)

**State of main:** `27f0215` (PR #343). Deploys **492–499** all `finished` and verified in production.
**Repo visibility:** **PRIVATE — owner ruling 2026-08-24** (supersedes the earlier go-public
instruction; do not flip it without a fresh explicit order).

## What landed today, in merge order

| PR | Deploy | What |
|---|---|---|
| #335 | 492 | TASKS.md reconciliation (16 stale flags) + STATUS |
| #336 | 493 | Task 5.9 — deterministic multi-store selection + switcher |
| #337 | 494 | Task 6.9 — per-store contact email on /kontak |
| #338 | 494 | /tema image controls: PDP gallery aspect (jsonb, merge-patch writers), CategoryNav aspect, paged picker with full preview |
| #340 | 495 | repo-wide conflict-marker guard + BUILD-LOG cleanup |
| #339 | 496 | Task 5.5 — seller topbar fits 320px |
| #341 | 497 | auto Google category on publish (`taxonomySafe` FK degradation) + collection image card to sidebar |
| #342 | 498 | **Finance overhaul** — see `specs/docs/FINANCE.md` (the money map) |
| #343 | 499 | **KiriminAja UAT pack + AutoLaris digital Create Order** — see below |

## The two contracts a collaborator must know before touching money or shipping

1. **`specs/docs/FINANCE.md`** — subscription PPN is a GLOBAL toggle (`platform_finance`, **default
   OFF** at launch, Super Admin → Pengaturan → Keuangan); checkout fees are ENFORCED (COD 3% of
   omset+ongkir + PPN 11% on the fee · QRIS 0,7% of omset · VA BCA 6.500 / others 3.500); the seller
   receives goods omset + goods PPN only; the ledger credits the added PPN. Faktur renders STORED
   `tax_idr`, never derived.
2. **AutoLaris is `/api/h2h/submit` with `courir_id=1` now** (digital order; AutoLaris = gateway
   only, shipping = KiriminAja). `channel_code` required; `total` = `grand_total` (provider admin
   nets against settlement). Callback accepts `trx_id` ∥ `transaction_id`. Client:
   `alCreateOrder()` in `@tokophi/lib/autolaris`.

## KiriminAja UAT — where it stands (gate for the production IP)

- Simulation `ops/kiriminaja-uat-sim.ts` ran **8/8 bookings** green; the OID table + volumetric
  pricing evidence + the **measured sandbox defect** (booking validator ignores weight scaling —
  a 2 kg parcel accepted at the 1 kg price, OID `5758-E1kgprice150`) live in the kiriminaja docs
  repo: `~/Documents/kiriminaja/documents/11-tokophi-uat/01-uat-simulation-2026-08-24.md`.
- Webhook receiver is live in code: `POST /api/public/kiriminaja/webhook` (hint-only → verified
  pull; bearer fail-closed). **Callback URL for the sheet:**
  `https://app.tokophi.com/api/public/kiriminaja/webhook`.

### Open — the short list

1. **UAT scenario 9 (cancel)**: waiting for a sandbox AWB to be issued on any of the UAT OIDs; run
   `kaTrack(oid)` until a waybill appears, then `kaCancelShipment(awb, …)`. N34: cancel takes the
   AWB, never the order id.
2. **Fill the UAT sheet** (screenshots + OIDs from the md above) and send it + the sandbox-defect
   finding to the KiriminAja team; **register the webhook URL** via their set-callback endpoint
   (one URL per account) once they confirm.
3. **Production watch after 499**: first real payment through `alCreateOrder` should be confirmed in
   the AutoLaris CMS as a digital order, and its callback (`transaction_id`) must resolve —
   the dual-era branch is in `api/public/pay/callback`.
4. N33 (seed writes 1×1×1 cm dims) still open; N35 (surface KIRIMINAJA_ENV) still open.
5. Finance follow-ups: none blocking; the PPN toggle stays **OFF** until the owner orders otherwise.

## Traps re-learned today (they cost time — do not repeat)

- **Never chain resolver + `git add/commit`**: a `;`-chain committed a conflicted BUILD-LOG *again*.
  Resolve, VERIFY 0 markers, then commit as separate steps.
- **`|||||||` (diff3 base) survives hand-resolutions** — main carried two such residues invisibly;
  the marker guard now catches it.
- **EADDRINUSE graded the wrong build twice more** — verify the port's PID belongs to the server you
  just started before trusting any result.
- A vitest mock that covers only the OLD provider function name lets the real network call escape —
  the `payment-request.test.ts` timeout was the proof the AL-ORDER switch was live.
- The KA sandbox issues **no waybills promptly** — don't burn time polling; the poller/webhook will
  catch it.

---

## Addendum — sesi berlanjut setelah handover pertama (PR #344–#349, deploy 500–504)

| PR | Deploy | What |
|---|---|---|
| #344 | (md-only) | handover pertama + STATUS refresh |
| #345 | 500 | **PPN OFF = zero caption** di admin tenant (baris aritmetika, row "PPN 11%", suffix widget bayar — semua hilang saat toggle off; caption Riwayat tetap karena membaca `tax_idr` TERSIMPAN) |
| #346 | 501 | **view `order_seller_entitlements` = rumus ledger** (migrasi `0102`: + PPN barang mode-exclusive − debit ongkir; kolom `sales_tax_added_idr`; test paritas view↔ledger dua mode) — laporan Keuangan/Penghasilan/rekonsiliasi kini melaporkan hak seller yang sama dengan saldo |
| #347 | 502 | saldo: folder harian + judul ringkas + kolom Jam |
| #348 | 503 | **Pemasaran presisi**: advanced matching selalu ON (migrasi `0103`, kolom dead record), config progresif (switch master di header), **`value` = nilai barang saja di ketiga platform** (guard `value-is-goods.test.ts`), demo store → penomoran tetap (`1008-1`) |
| #349 | 504 | saldo ronde-2: folder harian jadi **dropdown** (Mutasi + Penarikan), judul produk di rincian di-clamp 2 baris |

**Deliverable non-repo hari ini:**
- `~/Downloads/UAT Mas Ongkie X Kiriminaja - FINAL.pdf` + **`.docx`** (format sheet KA persis; DOCX punya placeholder logo untuk ditempel owner) — Test Log terisi status + OID, Action Items 3 butir untuk KA.
- Md UAT di repo docs kiriminaja **belum di-commit** (repo itu PUBLIC — keputusan publikasi di owner).

**Audit produksi (BUILD-LOG → PROD-AUDIT):** permata-store + batiknusantara sehat menyeluruh (feed number-scheme valid, fee schedule live, 5 cron hijau, ledger backed). Temuan data: tagline permata `mhgjhgjgj` = judul homepage jelek (hubungi merchant); Pelacakan permata belum dikonfigurasi; pembayaran `menunggu` = belanja belum dibayar, bukan callback rusak. Platform: **15 toko** (14 aktif).

**Rulings baru yang MENGIKAT (semuanya juga di AGENTS.md/FINANCE.md):**
1. PPN toggle OFF ⇒ tanpa keterangan PPN apa pun di tenant admin.
2. Hak seller = omset + PPN barang − debit ongkir (ledger DAN view — satu rumus).
3. Advanced matching selalu ON — jangan kembalikan toggle-nya.
4. Conversion `value` = nilai barang saja (Meta/GA4/TikTok).
5. Repo tetap **PRIVATE**.
