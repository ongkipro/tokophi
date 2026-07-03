"use server";
import { db, schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";

export type PageInput = {
  title: string;
  handle: string;
  body?: string;
  published: boolean;
  template?: string;
};

const fields = (i: PageInput) => ({
  title: i.title.trim(),
  handle: i.handle.trim(),
  body: i.body || null,
  status: (i.published ? "terbit" : "draft") as "terbit" | "draft",
  template: i.template || "page",
  updatedAt: new Date(),
});

export async function createPage(input: PageInput): Promise<string> {
  const { storeId: sid } = await requireCapability("content:write");
  const [p] = await db.insert(schema.pages).values({ storeId: sid, ...fields(input) }).returning();
  revalidatePath("/halaman");
  return p.id;
}

export async function updatePage(id: string, input: PageInput): Promise<void> {
  await requireCapability("content:write");
  await db.update(schema.pages).set(fields(input)).where(eq(schema.pages.id, id));
  revalidatePath("/halaman");
  revalidatePath(`/halaman/${id}`);
}

export async function deletePage(id: string): Promise<void> {
  await requireCapability("content:write");
  await db.delete(schema.pages).where(eq(schema.pages.id, id));
  revalidatePath("/halaman");
}
