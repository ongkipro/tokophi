import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { getCustomHostname, provisioningState } from "@/lib/cloudflare-saas";
import { cronIntervalSec, recordCronRun } from "../record-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 20;

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[cron/domains] CRON_SECRET unset in production — REJECTING.");
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({ id: schema.storeDomains.id, providerId: schema.storeDomains.providerId })
    .from(schema.storeDomains)
    .where(eq(schema.storeDomains.status, "provisioning"))
    .limit(BATCH);

  let activated = 0;
  let pending = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row.providerId) {
      failed++;
      await db
        .update(schema.storeDomains)
        .set({ status: "error", lastCheckedAt: new Date(), lastError: "ID aktivasi domain tidak tersimpan. Verifikasi ulang lewat dukungan." })
        .where(eq(schema.storeDomains.id, row.id));
      continue;
    }
    try {
      const provider = await getCustomHostname(row.providerId);
      const state = provisioningState(provider);
      await db
        .update(schema.storeDomains)
        .set({
          status: state.status,
          certStatus: state.certStatus,
          lastCheckedAt: new Date(),
          lastError: state.error,
        })
        .where(eq(schema.storeDomains.id, row.id));
      if (state.status === "active") activated++;
      else if (state.status === "error") failed++;
      else pending++;
    } catch (error: unknown) {
      failed++;
      const message = error instanceof Error ? error.message : "Status sertifikat gagal diperiksa.";
      await db
        .update(schema.storeDomains)
        .set({ lastCheckedAt: new Date(), lastError: message })
        .where(eq(schema.storeDomains.id, row.id));
    }
  }

  const summary = { scanned: rows.length, activated, pending, failed };
  await recordCronRun("domains", {
    ok: failed === 0,
    startedAt,
    intervalSec: cronIntervalSec(req),
    result: summary,
  });
  return NextResponse.json({ ok: true, ...summary });
}
