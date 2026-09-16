import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { quote, subscriptionCharge, type Cycle } from "@tokophi/lib/billing";
import { alCreateOrder } from "@tokophi/lib/autolaris";
import { payCallbackUrl } from "@tokophi/lib/pay-callback";
import { db, schema } from "./client";

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
  return {
    number: inv.number,
    cycle: inv.cycle === "annual" ? "annual" : "monthly",
    amountIdr: Number(inv.amountIdr),
    taxIdr: Number(inv.taxIdr ?? 0),
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
  const q = quote(input.cycle, store.firstInvoicePaid);
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
    items: [{ name: `Langganan TokoΦ (${q.cycle === "annual" ? "tahunan" : "bulanan"}${input.actor === "platform" ? ", manual" : ""})`, qty: 1, unitPrice: charge.total }],
  });
  if (!r.ok) return { ok: false, error: r.error ?? "Gagal membuat tagihan." };

  // `invoices.number` is UNIQUE and was minted from `Date.now()` alone — two stores billed in one
  // sweep inside the same millisecond collided, and the duplicate-key error escaped the cron's loop
  // and aborted the WHOLE sweep (found by the cron test, whose fixtures share a millisecond). Nine
  // timestamp digits keep the human-readable, time-ordered shape; a 3-symbol random tail (32⁷ per
  // ms) makes a collision a non-event.
  const number = "SUB-" + Date.now().toString().slice(-9) + randomBytes(2).toString("hex").slice(0, 3).toUpperCase();
  await db.insert(schema.invoices).values({
    number,
    accountId: store.accountId,
    storeId: store.id,
    kind: "subscription",
    amountIdr: charge.total,
    taxIdr: charge.taxIdr,
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
  return {
    ok: true,
    reused: false,
    detail: {
      number,
      cycle: q.cycle,
      amountIdr: charge.total,
      taxIdr: charge.taxIdr,
      channel: channelCode,
      virtualAccount: r.virtualAccount ?? null,
      qr: r.qr ?? null,
      paymentUrl: r.url ?? null,
    },
  };
}
