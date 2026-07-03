"use server";
import { db, schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type FollowupStatus = "menunggu" | "terkirim" | "dibalas" | "selesai";

export async function setFollowupStatus(id: string, status: FollowupStatus): Promise<void> {
  await db.update(schema.followups).set({ status }).where(eq(schema.followups.id, id));
  revalidatePath("/crm/followup");
  revalidatePath("/crm");
}
