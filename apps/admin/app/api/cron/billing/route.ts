import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@tokophi/db";
import { createSubscriptionInvoice } from "@tokophi/db/subscription-invoice";
import { eq } from "drizzle-orm";
import { computeBilling } from "@tokophi/lib/billing";
import { autolarisConfigured } from "@tokophi/lib/autolaris";
import { cronIntervalSec, recordCronRun } from "../record-run";
import { cronAuthorized } from "@/lib/cron-auth";
// Daily billing job (schedule via Coolify Scheduled Task / external cron → GET with the secret):
//   1) sync each store's stored `status` to its real-time EFFECTIVE state
//   2) for stores whose period ended (past_due/suspended) with no pending subscription invoice,
//      generate a monthly VA invoice so the merchant can renew.
// Suspension enforcement itself is already real-time (computeBilling in requireCapability), so this
// job is for stored-status accuracy + recurring invoice generation.
//
// ⚠️ THIS JOB MUST NOT OVERRULE AN OPERATOR. It used to write `computeBilling(s).status` from the
// billing columns alone, so a store super-admin had suspended was flipped back to `active`/`trial`
// on the next nightly run — the operator's decision expiring in silence, with nothing in the audit
// log to say it had been undone. `computeBilling` now folds `stores.suspended_at` into `status`, so
// the sync propagates the operator's decision instead of erasing it, and the invoice branch below
// reads `billingStatus` so the money half stays keyed on the subscription alone.
// The renewal bill rides a bank VA the provider offers on this account (`platform_payment_channels`
// VABCA, measured 2026-09-10). A channel CODE, never a bank nickname — `"BCA"` was the bug.
const RENEWAL_CHANNEL = "VABCA";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  // FAIL CLOSED in production, and HEADER ONLY. This used to read
  // `if (secret && provided !== secret)` — so with CRON_SECRET unset there was NO check at all, on a
  // route that is excluded from the auth middleware and walks EVERY store to suspend it or raise an
  // invoice against it. Anyone who guessed the path could bill the whole platform. It then accepted
  // the secret from `?secret=`, which is how every sidecar sent it. Both rules now live in ONE place —
  // `lib/cron-auth.ts` — because this check was copy-pasted into six route files.
  if (!cronAuthorized(req, "cron/billing")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const stores = await db
      .select({
        id: schema.stores.id,
        slug: schema.stores.slug,
        status: schema.stores.status,
        trialEndsAt: schema.stores.trialEndsAt,
        currentPeriodEnd: schema.stores.currentPeriodEnd,
        firstInvoicePaid: schema.stores.firstInvoicePaid,
        comped: schema.stores.comped,
        // 0086 — without this the job re-derives the status from billing ALONE and writes it back,
        // which is how an operator's "Tangguhkan" was silently reverted within 24 hours.
        suspendedAt: schema.stores.suspendedAt,
      })
      .from(schema.stores);

    let statusSynced = 0;
    let invoicesCreated = 0;
    let invoiceErrors = 0;
    for (const s of stores) {
      const b = computeBilling(s);
      if (b.status !== s.status) {
        await db.update(schema.stores).set({ status: b.status }).where(eq(schema.stores.id, s.id));
        statusSynced++;
      }

      if ((b.billingStatus === "past_due" || b.billingStatus === "suspended") && autolarisConfigured()) {
        // 🔴 Task 8.24 (finance audit F1): this block used to build its own bill — `alCreatePayment`
        // with `channelCode: "BCA"`, a code the provider has never known. The provider refused, no
        // invoice row was written, nothing was logged, and a lapsed store sat suspended with
        // nothing to pay. The ONE creator (`@tokophi/db` createSubscriptionInvoice) reuses a pending
        // invoice, submits with a real channel code and the owner's e-mail, and stores amount + tax.
        // A refusal is now LOGGED, so `invoicesCreated: 0` can be read.
        // One store's failure must cost one store, never the sweep: a thrown error here used to
        // escape to the outer catch and leave every store behind it unbilled for the day.
        try {
          const r = await createSubscriptionInvoice({ storeId: s.id, cycle: "monthly", channelCode: RENEWAL_CHANNEL, actor: "cron" });
          if (!r.ok) {
            console.error("[cron/billing] renewal invoice refused for", s.slug, "—", r.error);
            invoiceErrors++;
          } else if (!r.reused) invoicesCreated++;
        } catch (err) {
          console.error("[cron/billing] renewal invoice failed for", s.slug, err);
          invoiceErrors++;
        }
      }
    }

    // Liveness row (0091) — see `../record-run.ts`. A DAILY job is the one whose silence is hardest to
    // notice: a fortnight of no renewal invoices looks exactly like a fortnight where nothing was due.
    const summary = { stores: stores.length, statusSynced, invoicesCreated, invoiceErrors };
    await recordCronRun("billing", { ok: true, startedAt, intervalSec: cronIntervalSec(req), result: summary });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error("[cron/billing] sweep failed", error);
    await recordCronRun("billing", {
      ok: false,
      startedAt,
      intervalSec: cronIntervalSec(req),
      result: { error: error instanceof Error ? error.message : "sweep failed" },
    });
    return NextResponse.json({ ok: false, error: "sweep failed" }, { status: 500 });
  }
}
