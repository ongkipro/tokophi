# 0004 — Payments, COD & shipping are platform-managed (merchant "terima matang")

**Status:** accepted · 2026-07-02

## Decision
Payment gateways (Midtrans / Xendit / Duitku / …), **COD (bayar di tempat)**, and courier integrations (JNE / J&T / SiCepat / …) are configured and **owned by the platform (super-admin)** — once, centrally. Merchants do **not** register their own PSP/courier accounts or enter API credentials.

The **merchant admin** only **toggles which methods to accept**; everything arrives ready-to-use ("terima matang saja"). Resi & ongkir tariffs and payment settlement are handled by the platform.

## Why
- **Zero-setup onboarding** for Indonesian SMB sellers — no PSP/courier account hassle.
- Platform negotiates rates, aggregates volume, controls fees & settlement.
- Simpler merchant UX; platform is the single integration point.

## Implications
- **super-admin → Pengaturan = source of truth:** gateway credentials, COD (limit/area), courier accounts & tariffs — **applies to ALL stores**. (COD is a platform payment method there.)
- **merchant admin → Pengaturan = enable/disable only** (no credential fields); UI explicitly notes payments/COD/couriers are *"disediakan & dikelola oleh TokoΦ"*.
- **Shipping via aggregator:** the platform connects ONE shipping **aggregator** (KiriminAja (Mitra API)) that exposes all couriers + services + live rates. Merchant just **picks couriers and which services (ekspedisi)** to offer (JNE Reguler/YES/OKE, SiCepat REG/BEST/GOKIL, …); resi & tarif are automatic.
- **Backend (see SCHEMA):** gateway/courier/COD config + the aggregator connection live at **platform/account level**; per-store rows carry only an `enabled` flag (per courier **and per service**). Money flow: platform collects → settles/payouts to merchant.
- Consequence: platform bears integration + settlement responsibility (and can charge fees/margin).
