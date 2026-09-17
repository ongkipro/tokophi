# Go-live runbook — Task 8.34 steps 3–5 (real payment, real booking, real cancel)

> Written 2026-09-17 after the production health audit (BUILD-LOG 03:45, 05:10 and 07:15 UTC).
> Tracing: `TASKS.md` Task 8.34 · `specs/docs/KIRIMINAJA.md` §0 and §6 · `specs/docs/FINANCE.md` §0.
> Every step below spends real money or moves a real parcel, so every step is **owner-run**. The
> checks after each step are read-only and are what the main session runs to witness it.

## 0. State at the time of writing (measured)

| area | state | evidence |
|---|---|---|
| KiriminAja env | **production**, key from the Super Admin row | `api/health/env` → `kiriminaja: {env: production, envSource: db, key: db}` |
| KiriminAja account | quotes 12 couriers (jne, tiki, sicepat, jnt, jtcargo, anteraja, ninja, idx, sap, lion, ncs, spx) | BUILD-LOG 05:10 UTC |
| Checkout quote | live: batiknusantara → Mampang Prapatan 2 fast / 14 full rates | same |
| Answer caches | scoped per env + key, empty answers not cached | PR #401, deploy 544 |
| AutoLaris | key, callback secret and base set in the admin container (presence only) | env audit 07:15 UTC |
| Offered payment channels | QRIS, VABCA, VABNI, VABRI, VAMANDIRI, VAPERMATA (OVO off, owner ruling) | `platform_payment_channels` |
| Public callbacks | `pay/callback` and `kiriminaja/webhook` reachable, refuse unauthenticated calls with 401 | curl from outside |
| COD | platform on (cap Rp2.000.000, SPX only); batiknusantara `cod_enabled` | DB |
| Containers / errors | all app + cron containers healthy; 0 error lines; `backup-offsite` unhealthy (R2 unset, Task 8.4) | health audit |

## 1. Owner prerequisites — do these BEFORE any real booking

1. ✅ **DONE 2026-09-17 — production prefix is `PHI`** (vendor dashboard), set in Coolify and redeployed (deploy 546); the dashboard also shows the IP `45.77.33.112`, domain `https://tokophi.com` and the webhook URL below already registered on the production account, which closes prerequisite 2 as well. Original note: **Confirm the production account prefix.** `KIRIMINAJA_ORDER_PREFIX` is `5758`, which the docs record
   as the **sandbox** account's prefix (`KIRIMINAJA.md` §0.1). It is an env var, not part of the Super
   Admin card. If the production dashboard shows a different prefix, change it in Coolify and redeploy
   before booking; a booking with the wrong prefix is either refused or filed under an id the tracking
   poller cannot find.
2. **Register the webhook on the PRODUCTION account.** `https://app.tokophi.com/api/public/kiriminaja/webhook`
   was registered on the sandbox account (Task 8.15). The receiver accepts `Authorization: Bearer <active key>`,
   which is now the production key. Without the registration no `processed_packages` event arrives, so
   the sorting code can only come from the tracking poll.
3. **Decide who pays the courier for a NON-COD booking.** A non-COD booking returns `payment_status`
   unpaid plus a pay link; **until it is paid no waybill is issued** (`KIRIMINAJA.md` §6). The order
   detail screen shows that link under the shipment ("Bayar"). For the test, the owner pays it.
4. **Use a test product with its real weight and box.** Every active product on the real stores has
   `1×1×1 cm` dimensions (seed default, N33); the booking declares what the product row says.
5. **Use a store with a complete pickup address.** Only batiknusantara has phone + address + kecamatan
   today; no store has a KiriminAja kelurahan id (the field is omitted, which the vendor accepts).

## 2. Step 3 — one real prepaid payment (QRIS, smallest bill)

**Owner:** on `toko.tokophi.com` (batiknusantara), buy the cheapest product, pick a shipping rate, pay with
**QRIS**, and complete the payment in a banking app.

**Witness (main session, read-only):**
- `payments` row: `status` `menunggu` → `berhasil`; `amount_idr` = order total, `admin_fee` = our QRIS fee
  (0,7% of goods omset), `total` = `amount_idr + admin_fee` (Task 8.25).
- Admin log: the `pay/callback` line for that reference; **no** `paid-amount-mismatch shape=` line (F9). If
  one appears, it prints the body's field names/types — capture it and stop: the amount gate needs the
  vendor's real shape before anything else is trusted.
- `orders.financial_status = 'dibayar'`; one `ledger_entries` `sale` row for the order (never two).
- Super Admin dashboard: the demo store is `is_demo`, so the platform KPIs stay at Rp0 — that is correct.

## 3. Step 4 — one real booking a courier collects

Two acceptable shapes; the owner picks one.

- **COD via SPX** (no courier payment needed): checkout with COD on an SPX service to an address in one of
  the six COD provinces, ≤ Rp2.000.000.
- **The prepaid order from step 3**: book from the order detail ("Cek Ongkir" or the bulk screen), then pay
  the courier link shown under the shipment.

**Witness:**
- `orders.ka_order_id` starts with the confirmed production prefix; `ka_pickup_number` set; for non-COD,
  `ka_payment_status` moves to paid after the owner pays.
- `awb` stays NULL until the courier accepts — normal. `cron-tracking` (every 15 min) fills it; the admin
  log shows `awbRefused=false` with a real waybill (not `MOCK-`).
- `orders.sorting_code` filled for SPX/ID Express/J&T/J&T Cargo — from tracking or the webhook — and the
  printed label shows it above the barcode (`/pesanan/massal` → Cetak label).
- If the webhook is registered: the admin log shows a genuine KiriminAja call accepted (no
  `rejected … shape=` line). A rejection line here is Task 8.15's open risk becoming real — capture it.

## 4. Step 5 — one real cancel (before collection)

On a SECOND booking, after its waybill exists and before the courier collects: order detail → cancel.
Cancel takes the AWB only (N34); a non-COD void is queued up to 48 h.

**Witness:** the vendor accepts (`status: true`), the order shows the pending cancel, and
`cron-tracking` reconciles it (`cancelsReconciled`).

## 5. Rollback

- **Shipping:** Super Admin → Pengaturan → Kurir → switch the environment back to sandbox (owner rank; the
  switch tests the target key first). Checkout keeps quoting; bookings become sandbox bookings.
- **Payments:** switch a channel off in Super Admin → Pengaturan → Pembayaran. ⚠️ Before PR "Sync never
  switches a channel ON" is deployed, do **not** press "Sync kanal pembayaran" — it re-enabled OVO on
  2026-09-17 against the owner's ruling.

## 6. After all three

Close Task 8.9 and 8.34 with the evidence above, record the cutover date in `DEPLOY.md`, and update
`KIRIMINAJA.md` §0.1 (production state, production prefix) and §0.9 (sorting code seen for real).
