# ADR 0018 — Affiliate commission is paid by the platform out of the seller's balance, after delivery

**Status:** **proposed** — the principle is the owner's direction (2026-10-19). On 2026-10-19 the owner adopted the recommendations in §5 (DEC-019), which **answers Q1, Q3, Q6, Q7, Q8 and the first half of Q2**; **Q5 (tax) is open and blocks acceptance**, and two sub-points (Q2: what happens to a seller-marked `selesai`; Q4: who bears the transfer fee) are open. Nothing in this ADR is implemented. Move to *accepted* only when Q5 and those sub-points are answered.
**Date:** 2026-10-19
**Deciders:** the owner (Paduka Ongki). Drafted by Main Session (Claude Code).
**Supersedes (once accepted):** the "merchant pays affiliates outside TokoΦ" decision in
[`AFFILIATE_SPEC.md`](../AFFILIATE_SPEC.md) §12 (and §4 owner decision 3) and its consequences — §6
*no automatic payout, no deduction from the merchant's balance*; §3 and §6 *tax is the merchant's*; OD-A1
*flag only, TokoΦ cannot claw back*. That decision lives in the spec, not in an ADR file, so there is no ADR to mark superseded.

**Owner's words, verbatim (2026-10-19):** *"aturan affiliate ini jangan lupa -> dana affiliate bisa di
cairkan setelah barang benar2 terkirim dan memotong saldo seller"*.

---

## 1. Context

Today (built 2026-10-15, `AFFILIATE_SPEC.md`): a commission is `pending` from the order; when the order
reaches `selesai` it gets `eligible_at = now + store hold days` (default 3); once `eligible_at` has passed
it reads "siap dibayar"; the **merchant transfers the money themselves, outside TokoΦ**, and presses
"Tandai dibayar", which is a record, not a transfer. The platform writes **no** `ledger_entries` and **no**
`payouts` row for a commission.

Two facts about the code, checked 2026-10-19:

1. `selesai` has **three entry points, and nothing records which one wrote it**:
   (a) *automatic* — `apps/admin/lib/ka-tracking.ts` (`syncOrderFromKa`, called by the cron poller and, as a
   verified hint, by the courier webhook) maps the courier's package status code 200 to `delivered` →
   `selesai`, forward-only, for orders booked through the courier integration; (b) *seller-triggered but
   courier-evidenced* — the seller's "Lacak" action (`actions/shipping.ts`) calls the same `syncOrderFromKa`;
   (c) *manual* — the seller's status action (`setOrderStatus` → `applyOrderStatusChange`). The
   allowed-transition table (`order-status.ts`) permits `selesai` from `dikirim` and from `diproses`; the
   `diproses` entry exists so a courier-confirmed delivery can skip tracking events, but it equally lets a
   manual action set `selesai` before the parcel has left. So `selesai` is delivery evidence only when
   (a) or (b) wrote it, and today that cannot be told apart afterwards. (An earlier draft of this ADR
   said no automatic writer existed; that was wrong — it had grepped `lib/actions` and `app/api/cron` only —
   and was corrected on 2026-10-19 after a repository-wide grep.)
2. The platform already holds seller money as a custodian and writes negative ledger entries against it.
   The precedents are narrower than "platform costs": `shipping-order-debit` (`actions/shipping.ts`) is
   `kind: adjustment`, `status: pending`, and only the shipping-cost *difference* the seller owes;
   `payout.ts` writes a negative `payout` entry, status `available`, when a seller requests a withdrawal.
   Debiting the seller to fund a **third party** is new; the ledger mechanics are not.

**Decision drivers**
- The affiliate must be paid reliably; a seller who simply never marks "dibayar" must not be able to sit
  on a commission the affiliate earned.
- A commission must not become payable on a seller's say-so alone — only after the goods **really** arrived.
- Keep one money engine (the ledger); do not invent a second balance system.

**Non-goals**
- A platform fee on commissions, a tax calculation, or a bukti potong (see §4, §5 Q5 — undecided).
- Paying a commission before delivery, or estimating it like a marketplace "komisi estimasi".

## 2. Considered options

- **A — Keep "merchant pays outside TokoΦ" (status quo).** Good: no new platform liability, no tax duty on
  the platform. Bad: the affiliate depends on the seller's goodwill; "Tandai dibayar" is unverifiable; the
  owner has directed otherwise.
- **B — Reserve at payable time.** When delivery is evidenced and the hold has passed, the platform debits
  the seller's ledger for the commission and credits an affiliate-owed balance; the affiliate then requests
  a payout like a seller does. Good: the money is guaranteed before the affiliate sees "siap dibayar"; one
  ledger. Bad: needs a delivery signal we do not have today (Q2), and the seller's balance can be short (Q3).
- **C — Debit at withdrawal request.** The seller is debited only when the affiliate asks to withdraw. Good:
  seller cash is tied up for less time. Bad: the affiliate can be told "siap dibayar" and then be refused
  because the seller's balance is short — the exact trust failure this change is meant to remove.
- **D — Pay at delivery with no hold.** Good: fastest. Bad: no return window; a returned order is paid for.

## 3. Decision

**Direction (owner):** affiliate funds are releasable only after the goods have **truly been delivered**,
and are funded by **debiting the seller's balance**.

**Recommended mechanics (not yet accepted): Option B**, in this order:
1. *Delivered* means `selesai` **written by courier tracking** (`ka-tracking.ts`, code 200). The transition
   records its source (a new marker, e.g. `orders.selesai_source` = `courier` | `seller`), because today it
   does not. A seller-marked `selesai` is weaker evidence and does not make a commission payable on its
   own (Q2).
2. The existing hold (`affiliate_hold_days`, default 3) still runs from that delivered fact, as the return
   window.
3. At `eligible_at` the platform writes **one** seller ledger debit (new component, e.g.
   `affiliate-commission`) and marks the commission payable; a partial unique index makes a second debit
   for the same commission impossible, the way `ledger_one_sale_per_order` does for sales.
4. The affiliate requests a payout against their own bank details (`affiliates.bank_*`); the platform
   processes it through the same compare-and-swap payout path the sellers use.
5. A `retur`/`batal` before the debit cancels the commission; after the debit it is clawed back from the
   affiliate's unpaid balance, and if already paid it is recorded as a receivable (Q6).

Affected components: `packages/lib/src/ledger-credit.ts` (+ a new debit), `apps/admin/lib/actions/affiliates.ts`
("Tandai dibayar" becomes obsolete or changes meaning), order status / tracking, `apps/account` affiliate
screens ("Dibayar" would mean *paid by the platform*), Super Admin payouts, `AFFILIATE_SPEC.md`, `FINANCE.md`.

## 4. Consequences

- **Positive:** the affiliate is paid without depending on the seller; a commission is tied to a delivery
  fact, not a seller click; one ledger, one payout engine.
- **Negative — read these before accepting:**
  - **Custodian liability widens.** `AFFILIATE_SPEC.md` rejected this exact design for that reason ("adding
    third-party payouts would widen that liability"). The owner has now chosen it; it needs a legal read.
  - **Tax duty may move to the platform.** Today the *merchant* pays the affiliate, so any withholding is the
    merchant's. If the platform pays, the platform may be the withholding party. Marketplaces withhold PPh 21
    and collect a 16-digit NPWP before payout (see the research note; current rates and the effect of
    PP 20/2026 were **not** verified). This is OD-10 in the account spec, escalated by this decision.
  - **The delivered signal exists but is not attributable** (Context fact 1): courier-written and
    seller-written `selesai` look identical, and a seller can set it before shipping. Recording the source
    is part of this work, not a detail; orders shipped outside the courier integration have no courier fact at all.
  - **A seller's balance can be short or negative**, especially for COD (cash arrives later). Q3.
  - **`retur` after payment becomes reversible only if we hold the money**; once paid out, it is a receivable.
- **Neutral:** `affiliate_commissions` keeps `pending → dibayar | batal`; "siap dibayar" stays derived.

## 5. Questions and answers (owner adopted the recommendations on 2026-10-19 — DEC-019; status per row)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Debit the seller **when payable** (B) or **when the affiliate withdraws** (C)? | **ANSWERED (2026-10-19): when payable.** **B.** The affiliate must never see "siap dibayar" for money that is not there. |
| Q2 | What is "truly delivered"? And what about orders with no courier booking, or a seller-marked `selesai`? | **HALF ANSWERED:** courier-written `selesai` only. **OPEN:** whether a seller-marked or courier-less order is never payable or payable after an audited review plus a longer hold. Courier-written `selesai` only (source recorded). A seller-marked `selesai`, or an order with no courier booking, is either never payable or payable only after an audited review plus a longer hold — the owner decides which. |
| Q3 | If the seller's available balance is short at `eligible_at`? | **ANSWERED (2026-10-19): debit anyway; negative balance blocks the seller's own payouts.** Debit anyway into a negative balance that blocks the seller's own payouts until covered, and say so on the seller's screen. Alternative: hold the commission unpayable. |
| Q4 | Minimum payout, transfer fee, who bears the fee? | **PARTLY ANSWERED:** reuse the platform payout minimum, no fee on commissions. **OPEN:** who bears the bank-transfer fee. Reuse the platform payout minimum; no fee on commissions; decide the transfer-fee bearer explicitly. |
| Q5 | Tax: does the platform withhold/report for affiliates, and is NPWP required before payout? | **OPEN — blocks acceptance.** Needs a tax adviser (brief: `specs/docs/tasks/2026-10-19-adviser-brief-tax-and-legal.md`). **Do not ship payouts before a tax adviser answers.** Until then no screen may say the platform deducts tax. |
| Q6 | A return after the commission is paid out? | **ANSWERED (2026-10-19): receivable against future commissions.** Record a receivable against the affiliate's future commissions; never silently claw back bank money. |
| Q7 | What happens to commissions already `pending`/`siap` under the old rule when this ships? | **ANSWERED (2026-10-19): old commissions keep the old rule until paid or cancelled.** Honour them under the old rule until paid or cancelled; the new rule applies to commissions created after the cut-over. |
| Q8 | Is the affiliate shown the seller's balance or the reason a payout is waiting? | **ANSWERED (2026-10-19): never show the seller's balance.** No seller balance, ever; show only the commission's own state and the next date. |

## 6. Confirmation (to be written with the implementation)

- A real-Postgres test: one ledger debit per commission, a second attempt is a no-op; the debit equals the
  commission; no debit before a **courier-written** `selesai` and the hold (a seller-written one, including
  `diproses → selesai`, makes none); a `retur` before the debit writes none.
- A guard that "Tandai dibayar" can no longer move money-less state on a commission the platform owns.
- `specs/docs/FINANCE.md` money map gains the affiliate row in the same change.

## 7. More information

- [`AFFILIATE_SPEC.md`](../AFFILIATE_SPEC.md) §12 (the decision this would replace), OD-A1.
- [`specs/docs/FINANCE.md`](../docs/FINANCE.md) — the money map; ledger and payout rows.
- [`specs/docs/TOKOPHI_ACCOUNT_SPEC.md`](../docs/TOKOPHI_ACCOUNT_SPEC.md) §19–§20 (R6–R8, OD-10, rules register).
- [`specs/docs/tasks/2026-10-19-account-market-research.md`](../docs/tasks/2026-10-19-account-market-research.md) §5 (marketplace payout and tax practice, with evidence grades).
- Revisit when: the tax answer (Q5) arrives, or the `selesai` source marker (Q2) exists.
