# PRD: TokoPhi Centralized Buyer Account Portal (Akun Pembeli)

## Overview
TokoPhi is a multi-tenant, Shopify-style commerce SaaS designed for the Indonesian market. While merchants manage their operations via Seller Admin (`apps/admin`), consumers frequently buy across multiple independent TokoPhi-powered storefronts (`<slug>.tokophi.com` or custom domains) predominantly as guest shoppers using Indonesian phone numbers (`+62`).

The **TokoPhi Centralized Buyer Account Portal** (`Akun Pembeli`, accessible via `akun.tokophi.com` or `/account`) provides a unified, self-service destination where buyers can track orders across all TokoPhi merchants, monitor courier shipping milestones, resume pending payments (QRIS, Virtual Accounts, COD), manage reusable delivery addresses, control store privacy and messaging permissions, manage active multi-device sessions, and resolve after-sales issues.

---

## Product, Audience, and Indonesian Market Context

### 1. Target Audience & Personas
- **Primary User:** Indonesian retail consumers purchasing goods across multiple independent TokoPhi merchants (fashion, electronics, FMCG, culinary, specialty goods).
- **Behavioral Traits:**
  - **Mobile-First Shoppers:** Over 85% of traffic originates from smartphones (Chromium/Android, WebKit/iOS) via social ads (TikTok Ads, Meta Ads) or WhatsApp links.
  - **Friction-Averse / Passwordless Expectation:** Users resist lengthy registration forms or password creation during checkout. Identity is anchored on mobile phone numbers (`+628xxx`) verified via SMS or WhatsApp OTP.
  - **Dispersed Orders:** Buyers often do not realize that Store A (e.g. Batik Nusantara) and Store B (e.g. Kopi Wangi) run on the same platform infrastructure until logging into their consolidated account.
  - **Diverse Payment Ecosystem:** High preference for instant cashless rails (QRIS dynamic, BCA/Mandiri/BRI/BNI Virtual Accounts) alongside Cash on Delivery (COD) in non-tier-1 cities.
  - **Delivery Dependency on 3PL Couriers:** Regular need to check AWB (Nomor Resi) status across varied shipping aggregators (KiriminAja, AutoLaris) and couriers (JNE, SiCepat, J&T, SPX).

### 2. Indonesian Regulatory & Trust Context
- **UU Pelindungan Data Pribadi (UU PDP No. 27/2022):** Requires explicit consent for personal data processing, data minimization per merchant, transparent purpose limitation, and the user's right to revoke consent, unlink stores, export data, and request account deletion.
- **Merchant Data Isolation Invariant:** Stores operating on TokoPhi must NOT have visibility into a buyer's activity or addresses in other stores unless explicitly consented or transacted.
- **COD Refusal Risk & Fraud Prevention:** Uncontrolled COD leads to high Return-to-Origin (RTO) rates for merchants (courier refuse codes 310/311). The buyer account must provide transparent COD standing while remaining fair, verifiable, and offering appeal review for disputed delivery failures.

---

## Goals & Non-Goals

### Measurable Goals
1. **Unified Order Visibility:** Provide a single dashboard displaying 100% of orders linked to the buyer's verified phone number across all TokoPhi merchants within < 1.5s page load.
2. **Seamless Payment Resumption:** Reduce abandoned orders by allowing buyers with pending QRIS or Virtual Accounts to resume or refresh payment instructions directly from the account portal.
3. **Frictionless Address Reuse:** Enable buyers to manage saved shipping addresses with Kemendagri / KiriminAja subdistrict mapping, reducing checkout time for returning shoppers by > 50%.
4. **Order-Specific After-Sales Resolution:** Provide contextual customer support ticketing per order (shipping delays, damaged goods, return requests) with transparent audit status (`Menunggu peninjauan`, `Diproses`, `Selesai`).
5. **Zero Password Fatigue:** 100% passwordless authentication via OTP with robust session management and one-click remote session revocation.
6. **Mobile UX Parity:** Zero horizontal overflow and touch targets >= 44px across all standard mobile viewports (320px, 360px, 390px, 414px).

### Non-Goals
- **No Shared Marketplace Cart:** TokoPhi is a multi-tenant SaaS, not an open marketplace like Tokopedia or Shopee. There is NO cross-merchant unified shopping cart or cross-merchant checkout. Each store remains an independent business.
- **No In-House E-Wallet / Financial Holding:** TokoPhi does not act as an e-money issuer or stored-value wallet. Payments route through licensed payment gateways (Midtrans, Xendit, DOKU, AutoLaris) directly to merchant ledgers.
- **No Cross-Merchant Behavioral Tracking for Ads:** Buyer browsing history is not synthesized across merchants for advertising.
- **No Merchant Administration Controls:** The Buyer Account is strictly consumer-facing. Merchant controls remain solely inside Seller Admin (`apps/admin`).

---

## Information Architecture & Screen Contracts

```
[ Akun Pembeli TokoPhi ]
 │
 ├── Topbar Global
 │    ├── Brand Wordmark ("TokoΦ Akun")
 │    ├── Context Indicator ("Akun pembeli")
 │    ├── Theme Toggle (Dark / Light mode, localStorage persisted)
 │    ├── Notification Bell (with unread badge counter)
 │    └── Avatar / Profile Menu Shortcut (e.g. "SA" for Sari Andini)
 │
 ├── Sidebar (Desktop >= 1024px) / Bottom Navigation (Mobile <= 768px)
 │    ├── [1] Pesanan (/orders) [Default Landing]
 │    ├── [2] Toko (/stores)
 │    ├── [3] Alamat (/addresses)
 │    └── [4] Akun (/account)
 │
 ├── Core Views & Sub-Routes
 │    ├── /orders
 │    │    ├── Status Filter Tabs: Semua | Belum bayar | Aktif | Selesai | Retur | Dibatalkan
 │    │    ├── Search (Product name / Order number) & Store filter dropdown
 │    │    ├── Guest Order Claim Action ("Cari pesanan saya" modal)
 │    │    └── Order Cards (Store badge, Date, Status pill, Items, Total, Actions)
 │    │
 │    ├── /orders/:orderNumber (Order Detail)
 │    │    ├── Status-Led Action Banner (e.g. "Bayar sekarang", "Lacak paket", "Bantuan")
 │    │    ├── Navigation Links: Pembayaran | Pengiriman | Bukti pesanan
 │    │    ├── Line Items Breakdown with thumbnail, quantity, price
 │    │    ├── Snapshot Shipping Address (Immutable per order)
 │    │    └── Financial Summary (Subtotal, Ongkir, Diskon, Pajak, Total)
 │    │
 │    ├── /orders/:orderNumber/payment (Payment Resolution)
 │    │    ├── Payment Status: Pending | Paid | Expired | Delayed
 │    │    ├── QRIS Display (Dynamic QR code, countdown timer, download/screenshot)
 │    │    ├── Virtual Account (Bank name, VA number, copy button, step-by-step guides)
 │    │    └── Payment Simulation / Recheck Status action
 │    │
 │    ├── /orders/:orderNumber/tracking (Shipment Tracking)
 │    │    ├── Courier Name, Service Type (Reguler, Cargo, Instant) & AWB / Resi
 │    │    ├── Milestone Timeline (Picked up -> Sorting -> Out for delivery -> Delivered)
 │    │    └── Delivery Destination details
 │    │
 │    ├── /orders/:orderNumber/receipt (Official Order Receipt)
 │    │    ├── Transaction Reference, Store Name, Payment confirmation
 │    │    ├── Complete Itemized Invoice
 │    │    └── Print Action (`window.print()` clean media formatting)
 │    │
 │    ├── /orders/:orderNumber/help (Customer Support Intake)
 │    │    ├── Issue Category Selector (Pengiriman, Produk Rusak, Salah Barang, Retur, Lainnya)
 │    │    ├── Description input & supporting evidence
 │    │    └── Ticket Status Timeline (`Menunggu peninjauan`, etc.)
 │    │
 │    ├── /stores (Connected Merchants)
 │    │    ├── Connected Store Cards (Store Name, Category, Order count, Spent IDR)
 │    │    ├── Active Vouchers list with 1-click copy code
 │    │    ├── Store Permission Toggles (WhatsApp order updates, Marketing broadcasts)
 │    │    └── Disconnect / Unlink Merchant modal
 │    │
 │    ├── /addresses (Saved Delivery Addresses)
 │    │    ├── Address Cards with "Utama" (Default) badge
 │    │    ├── Inline Add / Edit / Delete native dialogs
 │    │    ├── Form Fields: Label, Recipient, Phone, Subdistrict (Kecamatan), Address, Postcode
 │    │    └── Invariant: Saved address edits NEVER overwrite historical order addresses
 │    │
 │    ├── /account (Profile, Security & Privacy)
 │    │    ├── Identity Details (Name, Phone number, Email)
 │    │    ├── Change Phone Number flow (Dual verification via OTP)
 │    │    ├── Multi-Device Active Sessions list with "Keluar dari perangkat lain"
 │    │    ├── COD Trust & Access Standing card with appeal review request
 │    │    ├── Data Privacy Controls (Download Data Archive, Delete Account Request)
 │    │    └── Sign Out ("Keluar dari akun")
 │    │
 │    └── /notifications (Pusat Notifikasi)
 │         ├── Notification Feed (Order updates, Courier tracking alerts, Store promos)
 │         ├── Mark All as Read action
 │         └── Direct links to affected order or store voucher
```

---

## Detailed Requirements (EARS-Style)

### 1. Authentication & Session Management
- **REQ-001 (Event):** When an unauthenticated user enters a valid Indonesian mobile number (`+628xxx` or `08xxx`) on the login screen, the system shall format the number to standard E.164 format and send a 6-digit verification code (OTP).
- **REQ-002 (Event):** When the user enters the correct 6-digit OTP, the system shall establish an authenticated HTTP-only secure session cookie, redirect the user to `/orders` (or their intended destination), and render the authenticated shell.
- **REQ-003 (Unwanted):** If an invalid or expired OTP is submitted, then the system shall reject the attempt, display an inline error message with polite feedback, and allow the user to request a new OTP after a 60-second cooldown.
- **REQ-004 (Event):** When the user clicks "Keluar dari perangkat lain" on `/account`, the system shall invalidate all other active session tokens associated with the account while maintaining the current active session.
- **REQ-005 (Event):** When the user initiates a phone number update on `/account`, the system shall require OTP verification on the new phone number before updating the primary identity record.
- **REQ-006 (State):** While a user's previous mobile number is inaccessible or lost, the system shall provide an Account Recovery Intake flow (`Nomor lama tidak bisa diakses?`) requiring proof of purchase and contact email for manual operator verification.

### 2. Multi-Store Order Aggregation & Navigation
- **REQ-007 (Ubiquitous):** The system shall aggregate and display all orders matching the buyer's verified phone number across all active TokoPhi merchant stores in a unified order list.
- **REQ-008 (State):** While the buyer applies a status tab filter (`Semua`, `Belum bayar`, `Aktif`, `Selesai`, `Retur`, `Dibatalkan`), the system shall filter the order list strictly to the matching status without reloading the page.
- **REQ-009 (Event):** When the user inputs keywords in the search box or selects a merchant from the store filter dropdown, the system shall filter orders matching the product title, order number, or merchant name.
- **REQ-010 (Event):** When the user clicks an order card, the system shall navigate to `/orders/:orderNumber` and present a status-led action header corresponding to the order's current lifecycle state.
- **REQ-011 (Unwanted):** If a user navigates to an unknown or nonexistent order number (`/orders/UNKNOWN`), then the system shall display an explicit empty state ("Data ini tidak tersedia") and provide a clear back link to `/orders`, never substituting an unrelated order.

### 3. Payment Continuation & Resolution
- **REQ-012 (State):** While an order has financial status `pending`, the system shall provide a direct action button "Bayar sekarang" leading to `/orders/:orderNumber/payment`.
- **REQ-013 (State):** While viewing a pending QRIS payment, the system shall render the dynamic QR code, remaining expiration countdown timer, total payable amount in IDR, and a payment simulation button for local testing.
- **REQ-014 (State):** While viewing a pending Virtual Account payment, the system shall display the issuing bank, formatted VA number, 1-click copy action, and expandable step-by-step payment instructions.
- **REQ-015 (Unwanted):** If payment instructions have expired (`payment=expired`), then the system shall disable the payment submission action, explain the expiration, and prompt the buyer to contact the merchant for order reissuance.

### 4. Shipping & Tracking Milestones
- **REQ-016 (Ubiquitous):** The system shall display courier name, service type, and Air Waybill (AWB / resi) for every fulfilled order on `/orders/:orderNumber/tracking`.
- **REQ-017 (Ubiquitous):** The system shall render chronological tracking milestones with status indicators (`done-step`), displaying location timestamps and courier notes.

### 5. Address Book Management & Invariants
- **REQ-018 (Ubiquitous):** The system shall allow buyers to store up to 10 delivery addresses with label, recipient name, phone, subdistrict (Kecamatan code), street address, and postal code.
- **REQ-019 (Ubiquitous - Invariant):** The system shall preserve the historical address snapshot on all placed orders; editing or deleting a saved address in `/addresses` shall NEVER alter shipping details on existing orders.
- **REQ-020 (Event):** When a user designates an address as "Utama" (Default), the system shall set `primary: true` for that record and set all other addresses to `primary: false`.

### 6. Connected Merchants & Data Privacy (UU PDP)
- **REQ-021 (Ubiquitous):** The system shall list all merchants with whom the buyer has transacted, providing independent toggles for transactional WhatsApp notifications and marketing broadcasts.
- **REQ-022 (Event):** When a user unlinks a store on `/stores`, the system shall revoke future promotional broadcast consent for that store and record the audit timestamp, while retaining past transactional records for legal compliance.

### 7. Guest Order Claiming
- **REQ-023 (Event):** When a user submits an order number and valid claim proof code via "Cari pesanan saya", the system shall link the guest order to the authenticated buyer account and display the newly claimed order in their order list.
- **REQ-024 (Unwanted):** If an incorrect claim proof code is entered, then the system shall reject the claim, show an error alert, and leave the account state unchanged.

### 8. COD Standing & Trust Review
- **REQ-025 (State):** While an account has verified COD courier refusal records (courier codes 310/311), the system shall display a COD Access Status card detailing the refusal count, threshold, and temporary restriction expiration date.
- **REQ-026 (Event):** When a buyer clicks "Ajukan peninjauan" on the COD status card, the system shall provide an appeal intake dialog allowing the buyer to submit delivery dispute evidence for operator review.

---

## UI/UX Design System & Screen Specifications

### 1. Visual Alignment with TokoPhi Seller Admin (`apps/admin`)
- **Tokens & Theming:**
  - Standard OKLch color tokens matching `apps/admin/app/globals.css`.
  - Brand Primary: `oklch(0.515 0.23 277)` (Indigo TokoPhi).
  - Background Light: `#ffffff` / `oklch(1 0 0)`; Background Dark: `oklch(0.145 0 0)`.
  - Muted Borders: `oklch(0.92 0 0)` / Dark `oklch(0.269 0 0)`.
  - Typography: Geist Sans (`font-family: Geist, system-ui, sans-serif`).
- **Shadcn/UI Base-Nova Aesthetic:**
  - Border radius: `rounded-xl` (12px) for cards, `rounded-lg` (8px) for buttons/inputs, `rounded-md` (6px) for badges and tabs.
  - Pastel Status Pills (Badges) with high contrast in both light and dark themes.
  - Soft elevation shadows: `box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.05)`.
- **Layout Constraints:**
  - Header: Fixed 64px height, sticky top, z-index 40, backdrop blur.
  - Sidebar: 256px fixed width on desktop (`>= 1024px`).
  - Main Content Area: Maximum width 1120px, 24px padding, centered beside sidebar (x=528px on 1920px viewports).
  - Mobile Shell (`< 768px`): Top header with brand and theme/notification/avatar shortcuts; fixed bottom navigation bar with 4 core icons (Pesanan, Toko, Alamat, Akun); 0px horizontal overflow across 320px/360px/390px.

---

## Technical Decisions (ADR-Lite)

- **ADR-A01: Passwordless Phone-First Authentication via OTP**
  - **Decision:** Authenticate buyers via phone number and 6-digit OTP, bypassing passwords entirely.
  - **Why:** Indonesian ecommerce buyers have > 85% drop-off when forced to create and remember passwords for multi-store SaaS checkout. Phone numbers match the primary contact used by couriers and payment gateways.
  - **Consequence:** Requires secure SMS/WhatsApp OTP gateway integration with rate limiting and replay prevention.

- **ADR-A02: Immutable Order Address Snapshots**
  - **Decision:** Every order stores an immutable copy of recipient name, phone, address, and subdistrict at the time of purchase.
  - **Why:** Prevents retroactively altering past delivery manifests, tax invoices, and courier contracts when a buyer updates their saved address book.
  - **Consequence:** Address book changes in `/addresses` only affect future checkouts, never existing order rows.

- **ADR-A03: Strict Merchant Data Silos under UU PDP**
  - **Decision:** Merchant stores cannot query or browse customer data from other stores in the platform database.
  - **Why:** Complies with Indonesian UU PDP No. 27/2022 and maintains merchant trust.
  - **Consequence:** Cross-store aggregation is performed solely inside the Buyer Account portal under the buyer's authenticated context.

---

## Milestones & Execution Plan

- [x] **v0.1 UX Prototype & Alignment:** Build standalone buyer portal prototype (`prototypes/tokophi-account`), implement light/dark themes, align with Seller Admin tokens and Geist font, pass 16 Playwright regression tests.
- [ ] **v0.2 Interactive Feature Polish:** Complete interactive notification management, payment copy actions, print-optimized receipt formatting, tracking milestones, and courier note support.
- [ ] **v0.3 Database & API Architecture (Task 5.8 Backend):** Implement centralized buyer identity table, session store, cross-store order projection APIs, and address synchronization in `@tokophi/db` and `@tokophi/admin`.
- [ ] **v0.4 Production Rollout & Storefront Integration:** Mount buyer portal on `akun.tokophi.com`, link from storefront topbar/checkout, and configure automated WhatsApp OTP delivery.
