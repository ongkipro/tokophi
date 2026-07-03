import "server-only";
import { db, schema } from "@indostore/db";
import { asc, eq } from "drizzle-orm";
import type { Lead, Followup, WaTemplate, FollowupType } from "@/lib/mock/store";

const ADMIN_TODAY = new Date("2026-06-30T00:00:00Z");
const SOURCE_DISPLAY: Record<string, Lead["source"]> = {
  whatsapp: "WhatsApp", instagram: "Instagram", tiktok: "TikTok", referral: "Referral", marketplace: "Marketplace",
};

export async function getLeads(): Promise<Lead[]> {
  const rows = await db.select().from(schema.leads).orderBy(asc(schema.leads.lastContactAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone ?? "",
    source: SOURCE_DISPLAY[r.source] ?? "WhatsApp",
    stage: r.stage,
    value_idr: r.valueIdr,
    lastContactDaysAgo: r.lastContactAt ? Math.round((ADMIN_TODAY.getTime() - r.lastContactAt.getTime()) / 86_400_000) : 0,
    note: r.note ?? "",
  }));
}

export async function getFollowups(): Promise<Followup[]> {
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
    dueDays: r.dueAt ? Math.round((r.dueAt.getTime() - ADMIN_TODAY.getTime()) / 86_400_000) : 0,
    status: r.status,
    lastMessage: r.lastMessage ?? "",
  }));
}

export async function getWaTemplates(): Promise<WaTemplate[]> {
  const rows = await db.select().from(schema.waTemplates).orderBy(asc(schema.waTemplates.name));
  return rows.map((r) => ({ id: r.id, name: r.name, type: (r.type ?? "keranjang") as FollowupType | "broadcast", body: r.body }));
}
