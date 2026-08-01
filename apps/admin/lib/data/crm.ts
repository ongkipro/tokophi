import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant } from "@/lib/tenant";
import { asc, eq } from "drizzle-orm";
import type { Lead, Followup, WaTemplate, FollowupType } from "@/lib/mock/store";

// ⚠️ THE REAL CLOCK. This was `ADMIN_TODAY = 2026-06-30`, the seed's frame, and it made the whole
// screen inert: a follow-up due TODAY computed `+32`, so `dueDays <= 0` — the filter behind "Perlu
// follow-up hari ini" and the overdue list — could never fire and the merchant's overdue queue was
// permanently empty. Nothing on the page said so. Same rule as `health.ts` and the discount editor:
// the seed may be anchored; the app is not. Computed here, on the server, and shipped as a number,
// so SSR === client (no `Date.now()` in a render path).
const SOURCE_DISPLAY: Record<string, Lead["source"]> = {
  whatsapp: "WhatsApp", instagram: "Instagram", tiktok: "TikTok", referral: "Referral", marketplace: "Marketplace",
};

export async function getLeads(): Promise<Lead[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db.select().from(schema.leads).orderBy(asc(schema.leads.lastContactAt));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone ?? "",
      source: SOURCE_DISPLAY[r.source] ?? "WhatsApp",
      stage: r.stage,
      value_idr: r.valueIdr,
      lastContactDaysAgo: r.lastContactAt ? Math.round((Date.now() - r.lastContactAt.getTime()) / 86_400_000) : 0,
      note: r.note ?? "",
    }));
  });
}

export async function getFollowups(): Promise<Followup[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db
      .select({
        id: schema.followups.id,
        customer: schema.customers.name,
        phone: schema.followups.phone,
        type: schema.followups.type,
        context: schema.followups.context,
        dueAt: schema.followups.dueAt,
        status: schema.followups.status,
        lastMessage: schema.followups.lastMessage,
      })
      .from(schema.followups)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.followups.customerId))
      .orderBy(asc(schema.followups.dueAt));
    return rows.map((r) => ({
      id: r.id,
      customer: r.customer ?? "—",
      phone: r.phone ?? "",
      type: r.type,
      context: r.context ?? "",
      dueDays: r.dueAt ? Math.round((r.dueAt.getTime() - Date.now()) / 86_400_000) : 0,
      status: r.status,
      lastMessage: r.lastMessage ?? "",
    }));
  });
}

export async function getWaTemplates(): Promise<WaTemplate[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db.select().from(schema.waTemplates).orderBy(asc(schema.waTemplates.name));
    return rows.map((r) => ({ id: r.id, name: r.name, type: (r.type ?? "keranjang") as FollowupType | "broadcast", body: r.body }));
  });
}
