"use server";
import { schema } from "@indostore/db";
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
