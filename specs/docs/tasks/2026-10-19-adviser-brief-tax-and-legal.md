# Brief for a tax adviser and a lawyer — TokoΦ Account, affiliate payout, returns and complaints

**Date:** 2026-10-19 · **Prepared by:** Main Session (Claude Code) for the owner · **Status:** a question list, **not advice and not an opinion.**
Nothing here says the product is lawful or unlawful. It states what the system does and what we need answered
before the owner's rule in [ADR 0018](../../decisions/0018-affiliate-commission-paid-from-seller-balance.md) is built
and before TokoΦ Account leaves local development ([DEC-018](../../../DECISIONS.md)). Statute text referred to was read
in its official form (research note §8); PP 33/2026 and PP 20/2026 were **not** read.

## 1. What TokoΦ is, in the facts that matter

- A multi-tenant platform where each **store** (merchant) sells to buyers on its own storefront. The platform takes
  the buyer's payment for prepaid orders (virtual account, QRIS, e-wallet; COD is paid to the courier), keeps a
  **ledger per store**, and pays the store out on request (a withdrawal minimum applies). The platform therefore
  **holds merchant money** between payment and payout.
- A **store affiliate programme** (built 2026-10-15): a store enables it, approves affiliates, and each order carrying
  an affiliate's code or link creates a **commission**, frozen at order time. A commission becomes payable after the
  order is `selesai` plus the store's hold days (default 3). **As built, the store pays the affiliate itself, outside
  TokoΦ**, and marks the commission paid; the platform writes no ledger or payout row for commissions.
- A **buyer/affiliate account** (`apps/account`, local only): one Google login, a buyer's saved orders across stores
  (only by a signed claim link plus consent), addresses, and an affiliate area across stores. Self-service closure.
- **Order completion:** an order reaches `selesai` by courier tracking (courier status 200) or by the seller's manual
  action; the system does not record which.

## 2. The owner's rule that needs a tax answer (ADR 0018)

*"Dana affiliate bisa dicairkan setelah barang benar-benar terkirim dan memotong saldo seller."* In the proposed design
the platform would (a) debit the seller's ledger when a commission becomes payable, (b) let the affiliate request a
payout, and (c) transfer it to the affiliate's bank account. Today the affiliate's bank details, name and phone are
stored per store; no NPWP/NIK is collected.

### Questions for the **tax adviser**
1. In that design, who is the withholding party for tax on the commission — the **platform**, the **store**, or both?
   Does it differ if the store pays directly (today) versus the platform paying from the seller's balance?
2. Which tax applies to an individual affiliate's commission (PPh 21 or another) and at what rate and base?
   What changed with **PP 20/2026**, and from when? Does it differ for a business-entity affiliate?
3. Is a **16-digit NPWP (NIK matched to NPWP)** required before a payout? What do we do for an affiliate without one?
4. What documents must the payer issue (bukti potong) and report, when, and to whom?
5. Is the platform's debit of the seller's balance and the payout to the affiliate **itself** a taxable supply for the
   platform (PPN) or a pass-through? Does a platform fee, if ever added, change the answer?
6. When an order is **returned after the commission was paid**, how is the tax treated if we record a receivable
   against the affiliate's future commissions (ADR 0018 Q6) rather than reclaiming money?
7. What must the product never say on screen about tax until this is answered?

## 3. Questions for the **lawyer**

**A. Classification and who owes what (PP 80/2019, official text read).**
1. Is each store a **Pelaku Usaha / Pedagang**, and is TokoΦ a **PPMSE**, under the regulation? Does the answer differ
   for the storefront, the Seller panel and the buyer account?
2. If so, who owes: the **complaint service** with a resolution period (Pasal 27); the **minimum 2 hari kerja** for
   exchange or cancellation on the Pasal 69(2) grounds, and its limits on charging the consumer (Pasal 69(3)–(4));
   the **refund mechanism** for a payment-receiving PPMSE (Pasal 71); periodic **delivery-status information**
   (Pasal 66)? Does the 2-working-day floor bind a store that publishes no return policy at all?
3. We let a store declare its own return window and complaint-resolution period (optional, no default; a declared
   return window cannot be below 2 hari kerja). Is that structure acceptable, or must TokoΦ require both before a store sells?

**B. Consumer protection (UU 8/1999, official text read).**
4. UU 8/1999 Pasal 18(1)(b),(c),(3) forbids a standard clause letting a business refuse the return of goods or money, and
   voids it. Is a **store's "tidak ada retur" statement** (on a product page, in the shop's terms) such a clause? Is
   TokoΦ's own terms of service for stores or buyers exposed in the same way?
5. Pasal 4 (h) / 7 (g): the buyer's complaint button opens the store's WhatsApp. Does the platform need a record of the
   complaint (a ticket) to discharge anything, or is a hand-off to the store enough?

**C. Personal data (UU 27/2022; PP 33/2026 text not located).**
6. Please obtain or confirm **PP 33/2026**. Does the buyer's consent screen (separate, un-ticked checkbox, scope listed
   above it, versioned, withdrawable per store) satisfy "specific, unambiguous, informed beforehand, not bundled with T&C"?
7. Account closure removes the account's sessions (device strings blanked), addresses, claim links and identity, keeps
   the store's own order/customer/ledger rows and the consent record, and keeps the store's affiliate record
   (name, phone, bank details) as `nonaktif`. Is that a sufficient response to a deletion/stop-processing request?
   What retention applies to **backups** and to store-held copies, and who is responsible for each?
8. Is a platform that holds Indonesian merchants' and affiliates' personal and bank data required to appoint a DPO,
   register anywhere, or run a breach-notification procedure (the 3x24-hour notice mentioned in press summaries)?

**D. Money handling.**
9. Does holding seller balances, and now **paying third-party affiliates from them**, change TokoΦ's status under
   payment-system or other financial regulation (licence, reporting, escrow)? We make no claim either way.
10. Are the buyer's payment-cancellation refunds (an existing refund flow records the refund and a Super Admin settles it)
    adequate against Pasal 71?

## 4. What we need back

Written answers with the **article numbers** relied on, in plain Indonesian, before: (1) any build of Task 9.14 (affiliate
payout); (2) any production launch of the account app; (3) any on-screen legal or tax wording. Until then the product
states **no legal basis and no tax effect on any buyer-facing screen** (account spec §20, RR-10, RR-15). The Seller
"Kebijakan retur" card does cite PP 80/2019 Pasal 69(1) as the source of the 2-working-day minimum; please confirm or
reword that sentence.

## 5. Where to look

- Rules register and what is not legally confirmed: `specs/docs/TOKOPHI_ACCOUNT_SPEC.md` §20, §20.5.
- The payout decision and its open questions: `specs/decisions/0018-affiliate-commission-paid-from-seller-balance.md`.
- The built affiliate rules: `specs/AFFILIATE_SPEC.md` (§3 tax is currently the merchant's; §12 merchant pays outside).
- Money map: `specs/docs/FINANCE.md`. Research and official-text excerpts: `specs/docs/tasks/2026-10-19-account-market-research.md` §5, §7, §8.
