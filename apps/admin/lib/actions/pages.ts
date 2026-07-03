"use server";
import { schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

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
  const id = await withTenant(sid, async (db) => {
    const [p] = await db.insert(schema.pages).values({ storeId: sid, ...fields(input) }).returning();
    return p.id;
  });
  revalidatePath("/halaman");
  return id;
}

export async function updatePage(id: string, input: PageInput): Promise<void> {
  const { storeId: sid } = await requireCapability("content:write");
  await withTenant(sid, (db) => db.update(schema.pages).set(fields(input)).where(eq(schema.pages.id, id)));
  revalidatePath("/halaman");
  revalidatePath(`/halaman/${id}`);
}

export async function deletePage(id: string): Promise<void> {
  const { storeId: sid } = await requireCapability("content:write");
  await withTenant(sid, (db) => db.delete(schema.pages).where(eq(schema.pages.id, id)));
  revalidatePath("/halaman");
}
