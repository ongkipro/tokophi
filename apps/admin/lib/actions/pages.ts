"use server";
import { db, schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type PageInput = {
  title: string;
  handle: string;
  body?: string;
  published: boolean;
  template?: string;
};

async function storeId() {
  const [s] = await db.select({ id: schema.stores.id }).from(schema.stores).limit(1);
  return s!.id;
}

const fields = (i: PageInput) => ({
  title: i.title.trim(),
  handle: i.handle.trim(),
  body: i.body || null,
  status: (i.published ? "terbit" : "draft") as "terbit" | "draft",
  template: i.template || "page",
  updatedAt: new Date(),
});

export async function createPage(input: PageInput): Promise<string> {
  const sid = await storeId();
  const [p] = await db.insert(schema.pages).values({ storeId: sid, ...fields(input) }).returning();
  revalidatePath("/halaman");
  return p.id;
}

export async function updatePage(id: string, input: PageInput): Promise<void> {
  await db.update(schema.pages).set(fields(input)).where(eq(schema.pages.id, id));
  revalidatePath("/halaman");
  revalidatePath(`/halaman/${id}`);
}

export async function deletePage(id: string): Promise<void> {
  await db.delete(schema.pages).where(eq(schema.pages.id, id));
  revalidatePath("/halaman");
}
