import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { codeDiscountFor, quote, subscriptionCharge, type Cycle } from "@tokophi/lib/billing";
import { alCreateOrder } from "@tokophi/lib/autolaris";
import { payCallbackUrl } from "@tokophi/lib/pay-callback";
import { uniqueViolationConstraint } from "@tokophi/lib/pg-errors";
import { db, schema } from "./client";

/** 0119 — at most one LIVE (menunggu) invoice carrying a code discount per store. */
export const LIVE_CODE_DISCOUNT_INDEX = "invoices_one_live_code_discount";

export type OwedCodeDiscount = { code: string | null; discountIdr: number };

/**
 * ADR 0020 — the signup-code discount THIS store is owed on its next subscription invoice, resolved by the
 * ONE rule (`codeDiscountFor`) from the store's own facts: `stores.signup_code` → the code's
 * `discount_first_invoice_idr`, `first_invoice_paid`, `comped`, and whether ANY subscription invoice of the
 * store is `dibayar` (a manual "Lunas" flip does not set `first_invoice_paid`, ruling 2026-08-20, and must
 * still consume the discount; comp invoices are gifts, not payments). The code's `active` flag is NOT read:
 * a discount granted at signup survives the code being deactivated later.
 *
 * Owner pool on purpose: `signup_codes` has RLS with no policy (0117), so the merchant role reads nothing
 * there. The store filter is explicit — `stores` has no store_id and RLS does not police it.
 */
export async function owedCodeDiscount(storeId: string): Promise<OwedCodeDiscount> {
  const [r] = await db
    .select({
      code: schema.stores.signupCode,
      codeDiscountIdr: schema.signupCodes.discountFirstInvoiceIdr,
      firstInvoicePaid: schema.stores.firstInvoicePaid,
      comped: schema.stores.comped,
      // Qualified BY NAME inside the correlated subquery (correlated-subquery-scoping.test.ts).
      hasPaidSubscription: sql<boolean>`exists (select 1 from invoices i where i.store_id = "stores"."id" and i.status = 'dibayar' and coalesce(i.kind, 'subscription') <> 'comp')`,
    })
    .from(schema.stores)
    .leftJoin(schema.signupCodes, eq(schema.signupCodes.code, schema.stores.signupCode))
    .where(eq(schema.stores.id, storeId))
    .limit(1);
  if (!r) return { code: null, discountIdr: 0 };
  const discountIdr = codeDiscountFor({
    codeDiscountIdr: r.codeDiscountIdr === null ? 0 : Number(r.codeDiscountIdr),
    firstInvoicePaid: r.firstInvoicePaid,
    hasPaidSubscription: r.hasPaidSubscription === true || String(r.hasPaidSubscription) === "true",
    comped: r.comped,
  });
  return { code: discountIdr > 0 ? r.code : null, discountIdr };
}

/**
 * THE ONE subscription-invoice creator (Task 8.24, finance audit 2026-09-16 F1).
 *
 * Three call sites used to build the bill three ways: the billing cron sent the provider
 * `channelCode: "BCA"` — not a channel code the provider (or `platform_payment_channels`) has ever
 * known; the provider refused, `r.ok` was false, and NO invoice row was written, silently, so a
 * lapsed store sat `past_due → suspended` with nothing to pay. The same cron was also the only
 * caller of `create_payment`, where the payer transfers `amount + admin` (Rp275.000 + Rp6.500),
 * while the merchant flow and the manual invoice use `submit` (fee netted) — one merchant, two
 * prices — and the exact-amount gate in `pay/callback` would then have ignored the paid callback.
 *
 * So the bill is built HERE, once: `quote()` for the cycle, `subscriptionCharge()` under the global
 * PPN toggle read at creation time, `alCreateOrder` (submit) with a REAL channel code, the store
 * owner's e-mail as the payer, and BOTH numbers stored on the row (`amount_idr` = billed,
 * `tax_idr` = the PPN actually added). A pending invoice is REUSED, never duplicated — the rule the
 * merchant flow already had.
 *
 * ADR 0020 (2026-11): the signup-code first-invoice discount is decided here too, from the store's own
 * `signup_code` (`owedCodeDiscount`), and stored on the row (`code_discount_idr`, `discount_code`).
 *
 * Lives in `@tokophi/db` because both apps (admin, super-admin) need it and neither may import the
 * other; `@tokophi/db` already depends on `@tokophi/lib`. It is exported ONLY as the subpath
 * `@tokophi/db/subscription-invoice`, never from the package index: the storefront bundles the
 * index, and a module that pulls the payment provider into a shopper-facing bundle is a defect
 * (measured — the first draft re-exported it and `verify -w @tokophi/storefront` failed to build).
 * The provider call is injectable so the cron can be driven against real Postgres with the network
 * stubbed.
 */
export type SubscriptionInvoiceInput = {
  storeId: string;
  cycle: Cycle;
  /** A `platform_payment_channels.channel` code, e.g. `VABCA`. Never a bank nickname. */
  channelCode: string;
  /** Who asked — for the CMS line item and the audit trail. */
  actor: "cron" | "merchant" | "platform";
  /** Test seam. Defaults to the real provider call. */
  provider?: typeof alCreateOrder;
};

export type SubscriptionInvoiceDetail = {
  number: string;
  cycle: Cycle;
  amountIdr: number;
  taxIdr: number;
  /** ADR 0020 — the signup-code discount (DPP) inside `amountIdr`; 0 = none. */
  codeDiscountIdr: number;
  discountCode: string | null;
  channel: string;
  virtualAccount: string | null;
  qr: string | null;
  paymentUrl: string | null;
};

export type SubscriptionInvoiceResult =
  | { ok: true; detail: SubscriptionInvoiceDetail; reused: boolean }
  | { ok: false; error: string };

/** A payer e-mail the provider will accept when a store somehow has no owner row. Never a real inbox. */
const FALLBACK_PAYER_EMAIL = "merchant@tokophi.id";
/** The provider requires a phone; the merchant's is not collected for billing. Same placeholder all three paths used. */
const PLACEHOLDER_PHONE = "081200000000";

async function pendingInvoice(storeId: string): Promise<SubscriptionInvoiceDetail | null> {
  const [inv] = await db
    .select({
      number: schema.invoices.number,
      cycle: schema.invoices.cycle,
      amountIdr: schema.invoices.amountIdr,
      taxIdr: schema.invoices.taxIdr,
      codeDiscountIdr: schema.invoices.codeDiscountIdr,
      discountCode: schema.invoices.discountCode,
      channel: schema.invoices.channel,
      virtualAccount: schema.invoices.virtualAccount,
      qr: schema.invoices.qr,
      paymentUrl: schema.invoices.paymentUrl,
    })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.storeId, storeId), eq(schema.invoices.kind, "subscription"), eq(schema.invoices.status, "menunggu")))
    .orderBy(desc(schema.invoices.issuedAt))
    .limit(1);
  if (!inv) return null;
  // A pending invoice is returned EXACTLY as issued — an invoice raised at the old price (or the old
  // Rp50rb promo) before ADR 0020 keeps that amount; nothing re-prices a stored invoice (owner decision 7).
  return {
    number: inv.number,
    cycle: inv.cycle === "annual" ? "annual" : "monthly",
    amountIdr: Number(inv.amountIdr),
    taxIdr: Number(inv.taxIdr ?? 0),
    codeDiscountIdr: Number(inv.codeDiscountIdr ?? 0),
    discountCode: inv.discountCode ?? null,
    channel: inv.channel ?? "",
    virtualAccount: inv.virtualAccount ?? null,
    qr: inv.qr ?? null,
    paymentUrl: inv.paymentUrl ?? null,
  };
}

export async function createSubscriptionInvoice(input: SubscriptionInvoiceInput): Promise<SubscriptionInvoiceResult> {
  const channelCode = input.channelCode.trim().toUpperCase();
  if (!channelCode) return { ok: false, error: "Pilih metode pembayaran dulu." };

  const pending = await pendingInvoice(input.storeId);
  if (pending) return { ok: true, detail: pending, reused: true };

  const [store] = await db
    .select({
      id: schema.stores.id,
      accountId: schema.stores.accountId,
      slug: schema.stores.slug,
      name: schema.stores.name,
      firstInvoicePaid: schema.stores.firstInvoicePaid,
    })
    .from(schema.stores)
    .where(eq(schema.stores.id, input.storeId))
    .limit(1);
  if (!store) return { ok: false, error: "Toko tidak ditemukan." };

  // The payer is the store's OWNER — the person the provider will e-mail the bill to. The three
  // paths disagreed here too: the cron sent a platform mailbox, the manual invoice the owner's,
  // the merchant flow the signed-in user's (who may be staff).
  const [owner] = await db
    .select({ email: schema.users.email, name: schema.users.name })
    .from(schema.storeUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
    .where(and(eq(schema.storeUsers.storeId, store.id), eq(schema.storeUsers.role, "owner")))
    .limit(1);

  const [fin] = await db
    .select({ on: schema.platformFinance.subscriptionPpnEnabled })
    .from(schema.platformFinance)
    .where(eq(schema.platformFinance.id, 1))
    .limit(1);
  // ADR 0020 — the price is decided HERE, on the server, from the store's own facts; nothing the caller
  // (merchant, cron, operator) says can move it. The code discount comes off the DPP and PPN (when on)
  // is computed on the discounted DPP; both numbers and the discount are stored on the row.
  const owed = await owedCodeDiscount(store.id);
  const q = quote(input.cycle, store.firstInvoicePaid, owed.discountIdr);
  if (q.amount <= 0) {
    // A code worth the whole price would mint a Rp0 bill the provider refuses; the Super Admin form
    // caps a code below the monthly price, so this is a misconfiguration, never a free month.
    console.error(`[subscription-invoice] code discount ${owed.discountIdr} >= ${q.listAmount} for store ${store.id} — refused`);
    return { ok: false, error: "Tagihan tidak bisa dibuat — hubungi TokoΦ." };
  }
  const charge = subscriptionCharge(q.amount, fin?.on ?? false);

  const reffId = `SUB-${store.slug.slice(0, 12)}-${Date.now().toString().slice(-8)}`;
  const provider = input.provider ?? alCreateOrder;
  const r = await provider({
    reffId,
    channelCode,
    amount: charge.total,
    customerName: owner?.name?.trim() || store.name,
    customerPhone: PLACEHOLDER_PHONE,
    customerEmail: owner?.email ?? FALLBACK_PAYER_EMAIL,
    callbackUrl: payCallbackUrl(reffId),
    items: [{ name: `Langganan TokoΦ (${q.cycle === "annual" ? "tahunan" : "bulanan"}${q.codeDiscountIdr > 0 ? `, potongan kode ${owed.code}` : ""}${input.actor === "platform" ? ", manual" : ""})`, qty: 1, unitPrice: charge.total }],
  });
  if (!r.ok) return { ok: false, error: r.error ?? "Gagal membuat tagihan." };

  // `invoices.number` is UNIQUE and was minted from `Date.now()` alone — two stores billed in one
  // sweep inside the same millisecond collided, and the duplicate-key error escaped the cron's loop
  // and aborted the WHOLE sweep (found by the cron test, whose fixtures share a millisecond). Nine
  // timestamp digits keep the human-readable, time-ordered shape; a 3-symbol random tail (32⁷ per
  // ms) makes a collision a non-event.
  const number = "SUB-" + Date.now().toString().slice(-9) + randomBytes(2).toString("hex").slice(0, 3).toUpperCase();
  const discountCode = q.codeDiscountIdr > 0 ? owed.code : null;
  try {
    await db.insert(schema.invoices).values({
      number,
      accountId: store.accountId,
      storeId: store.id,
      kind: "subscription",
      amountIdr: charge.total,
      taxIdr: charge.taxIdr,
      codeDiscountIdr: q.codeDiscountIdr,
      discountCode,
      cycle: q.cycle,
      periodMonths: q.months,
      reffId,
      trxId: r.trxId,
      channel: channelCode,
      virtualAccount: r.virtualAccount ?? null,
      qr: r.qr ?? null,
      paymentUrl: r.url ?? null,
      status: "menunggu",
    });
  } catch (e) {
    // Two creators raced past the pending-reuse read above (merchant click + cron, two tabs) and both
    // carried the discount: 0119's partial unique index lets ONE live discounted invoice exist. The
    // loser answers with the winner's invoice, exactly as if it had arrived a moment later. Its
    // provider order is left unmatched — no invoice row points at it, so a payment to it is ignored
    // by pay/callback like any other unknown reference.
    if (uniqueViolationConstraint(e) !== LIVE_CODE_DISCOUNT_INDEX) throw e;
    const winner = await pendingInvoice(store.id);
    if (winner) return { ok: true, detail: winner, reused: true };
    throw e;
  }
  return {
    ok: true,
    reused: false,
    detail: {
      number,
      cycle: q.cycle,
      amountIdr: charge.total,
      taxIdr: charge.taxIdr,
      codeDiscountIdr: q.codeDiscountIdr,
      discountCode,
      channel: channelCode,
      virtualAccount: r.virtualAccount ?? null,
      qr: r.qr ?? null,
      paymentUrl: r.url ?? null,
    },
  };
}
