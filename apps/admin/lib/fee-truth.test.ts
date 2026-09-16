import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { codeOnly } from "../../../test/source-code";

// Task 8.25, decision (a) — THE PLATFORM COLLECTS THE GATEWAY FEE ITSELF.
//
// `/api/public/order` used to bill the PSP with `alCreatePayment` (`create_payment`) for the ORDER
// total, and the PROVIDER added its own admin fee on top — so the shopper paid our prediction of
// the provider's fee, wrong whenever the two schedules differ (audit F2: QRIS 0,7% of omset vs
// 0,7% of the grand total, measured Rp1.323 vs Rp1.372 on one order). The fix is a contract, not a
// number: bill via `alCreateOrder` (`submit`) for `buyerPayableIdr` = order payable + OUR fee, which
// the PSP treats as the grand total and nets its own fee against settlement. These claims are about
// what the route EXECUTES, so they read its code — a comment naming the old call must not match.

const route = () => codeOnly(readFileSync(new URL("../app/api/public/order/route.ts", import.meta.url), "utf8"));
const callback = () =>
  codeOnly(readFileSync(new URL("../app/api/public/pay/callback/route.ts", import.meta.url), "utf8"));

const billsViaSubmit = (code: string) => /alCreateOrder\s*\(\s*\{/.test(code);
const billsBuyerPayable = (code: string) => /amount\s*:\s*finance\s*\.\s*buyerPayableIdr/.test(code);
const usesCreatePayment = (code: string) => /\balCreatePayment\b/.test(code);
const insertsOurFee = (code: string) =>
  /adminFee\s*:\s*finance\s*\.\s*gatewayFeeIdr/.test(code) && /total\s*:\s*finance\s*\.\s*buyerPayableIdr/.test(code);
const callbackMatchesTotal = (code: string) =>
  /payCallbackAmountMatches\s*\(\s*body\s*\.\s*amount\s*,\s*payment\s*\.\s*total\s*\?\?\s*payment\s*\.\s*amountIdr\s*\)/.test(code);

describe("order API — the platform bills the fee it shows (Task 8.25 a)", () => {
  it("bills the PSP through the submit endpoint, never create_payment", () => {
    const code = route();
    expect(billsViaSubmit(code), "alCreateOrder({…}) is not called").toBe(true);
    expect(usesCreatePayment(code), "alCreatePayment is back — the provider would add its fee on top").toBe(false);
  });

  it("submits buyerPayable (order + our fee) as the grand total", () => {
    expect(billsBuyerPayable(route())).toBe(true);
  });

  it("writes payments.admin_fee = our fee and payments.total = buyerPayable at insert, not from the provider", () => {
    expect(insertsOurFee(route())).toBe(true);
  });

  it("the paid callback accepts the amount we billed (payments.total), falling back to amount_idr", () => {
    expect(callbackMatchesTotal(callback())).toBe(true);
  });

  // Self-proof: each predicate must go red on a copy with the old shape put back, so none of them can
  // be green for want of matching anything (the rule in `public-guard.test.ts`).
  it("each claim fires on the old code", () => {
    const code = route();
    const oldCall = code.replace(/alCreateOrder\s*\(\s*\{/, "alCreatePayment ( {");
    expect(billsViaSubmit(oldCall)).toBe(false);
    expect(usesCreatePayment(oldCall)).toBe(true);
    const oldAmount = code.replace(/amount\s*:\s*finance\s*\.\s*buyerPayableIdr/, "amount : total");
    expect(billsBuyerPayable(oldAmount)).toBe(false);
    const oldInsert = code.replace(/adminFee\s*:\s*finance\s*\.\s*gatewayFeeIdr/, "adminFee : 0");
    expect(insertsOurFee(oldInsert)).toBe(false);
    const oldCb = callback().replace(/payment\s*\.\s*total\s*\?\?\s*payment\s*\.\s*amountIdr/, "payment . amountIdr");
    expect(callbackMatchesTotal(oldCb)).toBe(false);
  });
});

// The seller's RE-BILL (`createOrderPayment`) is the second writer of a bill and used to submit
// `order.total` alone — under-billed by the fee, flagged by reconciliation on every re-issued VA.
const rebill = () => codeOnly(readFileSync(new URL("./actions/payments.ts", import.meta.url), "utf8"));
const rebillSubmitsBuyerPayable = (code: string) => /amount\s*:\s*claim\s*\.\s*buyerPayable\b/.test(code);
const rebillWritesOurFee = (code: string) =>
  /adminFee\s*:\s*claim\s*\.\s*gatewayFee\b/.test(code) && /total\s*:\s*claim\s*\.\s*buyerPayable\b/.test(code);
const rebillTrustsProviderFee = (code: string) => /providerResult\s*\.\s*(admin|total)\b/.test(code);

describe("seller re-bill — same fee contract as the order API", () => {
  it("submits order total + our fee as the grand total", () => {
    expect(rebillSubmitsBuyerPayable(rebill())).toBe(true);
    expect(rebillSubmitsBuyerPayable(codeOnly("amount: claim.order.total,"))).toBe(false);
  });
  it("writes payments.admin_fee/total from OUR fee, never from the provider's reply", () => {
    const code = rebill();
    expect(rebillWritesOurFee(code)).toBe(true);
    expect(rebillTrustsProviderFee(code)).toBe(false);
    expect(rebillTrustsProviderFee(codeOnly("adminFee: providerResult.admin ?? 0,"))).toBe(true);
  });
  it("derives the fee through paymentFee with both bases, from the channel's platform kind", () => {
    const code = rebill();
    expect(/paymentFee\s*\(\s*channel\s*\.\s*kind/.test(code)).toBe(true);
    expect(/omsetIdr\s*:/.test(code) && /payableIdr\s*:/.test(code)).toBe(true);
  });
});
