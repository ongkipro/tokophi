import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { eq, or } from "drizzle-orm";

// AutoLaris payment callback — POSTed when a bill is paid/expired. Matches by trx_id / reff_id
// and updates the payment row. Idempotent; always 200 so AutoLaris doesn't retry forever.
// (Public URL needed in prod; locally this endpoint exists but AutoLaris can't reach localhost.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { trx_id?: string; reff_id?: string; status?: string; paid_at?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* tolerate form-encoded / empty */
  }
  const trx = body.trx_id;
  const reff = body.reff_id;
  const status = (body.status ?? "").toUpperCase();
  if (trx || reff) {
    const mapped = status === "PAID" ? "berhasil" : status === "EXPIRED" ? "gagal" : null;
    if (mapped) {
      const rows = await db
        .update(schema.payments)
        .set({ status: mapped, paidAt: mapped === "berhasil" ? new Date() : null })
        .where(or(trx ? eq(schema.payments.trxId, trx) : undefined, reff ? eq(schema.payments.reffId, reff) : undefined))
        .returning({ orderId: schema.payments.orderId });
      // sync the linked order's financial status when paid
      if (mapped === "berhasil") {
        const orderIds = rows.map((r) => r.orderId).filter((id): id is string => !!id);
        for (const oid of orderIds) {
          await db.update(schema.orders).set({ financialStatus: "dibayar" }).where(eq(schema.orders.id, oid));
        }
      }
    }
  }
  return NextResponse.json({ ok: true });
}
