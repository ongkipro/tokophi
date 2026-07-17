"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

export type FollowupStatus = "menunggu" | "terkirim" | "dibalas" | "selesai";

export async function setFollowupStatus(id: string, status: FollowupStatus): Promise<void> {
  const { storeId: sid } = await requireCapability("crm:write");
  await withTenant(sid, (db) => db.update(schema.followups).set({ status }).where(eq(schema.followups.id, id)));
  revalidatePath("/crm/followup");
  revalidatePath("/crm");
}

// leads.source is a lowercase pgEnum; the client carries the display casing ("WhatsApp") — lowercase back.
type LeadSourceDb = "whatsapp" | "instagram" | "tiktok" | "referral" | "marketplace";
type LeadStage = "baru" | "dihubungi" | "nego" | "closing" | "menang" | "kalah";
const SOURCE_VALUES: LeadSourceDb[] = ["whatsapp", "instagram", "tiktok", "referral", "marketplace"];

export async function createLead(input: {
  name: string; phone: string; source: string; valueIdr: number; note: string;
}): Promise<void> {
  const { storeId: sid } = await requireCapability("crm:write");
  const name = input.name.trim();
  if (!name) throw new Error("Nama prospek wajib diisi.");
  const src = input.source.toLowerCase();
  const source = (SOURCE_VALUES as string[]).includes(src) ? (src as LeadSourceDb) : "whatsapp";
  await withTenant(sid, (db) =>
    db.insert(schema.leads).values({
      storeId: sid,
      name,
      phone: input.phone.trim() || null,
      source,
      valueIdr: Math.max(0, Math.round(input.valueIdr) || 0),
      note: input.note.trim() || null,
      lastContactAt: new Date(),
    }),
  );
  revalidatePath("/crm/pipeline");
  revalidatePath("/crm");
}

export async function setLeadStage(id: string, stage: LeadStage): Promise<void> {
  const { storeId: sid } = await requireCapability("crm:write");
  await withTenant(sid, (db) =>
    db.update(schema.leads).set({ stage, lastContactAt: new Date() }).where(eq(schema.leads.id, id)),
  );
  revalidatePath("/crm/pipeline");
  revalidatePath("/crm");
}

export async function deleteLead(id: string): Promise<void> {
  const { storeId: sid } = await requireCapability("crm:write");
  await withTenant(sid, (db) => db.delete(schema.leads).where(eq(schema.leads.id, id)));
  revalidatePath("/crm/pipeline");
  revalidatePath("/crm");
}
