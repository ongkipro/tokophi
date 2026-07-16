"use server";
import { db, schema } from "@tokophi/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { saveImage, checkFile, deleteImageFile } from "@/lib/image-store";

// ---- product images (product_media + registered in the media library) ----
export async function uploadProductImage(productId: string, formData: FormData): Promise<void> {
  const { storeId: sid } = await requireCapability("media:write");
  const file = formData.get("file");
  checkFile(file);
  const saved = await saveImage(Buffer.from(await file.arrayBuffer()), file.type, `${productId}-${Date.now()}`);

  await withTenant(sid, async (db) => {
    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${schema.productMedia.position}), -1)`.mapWith(Number) })
      .from(schema.productMedia)
      .where(eq(schema.productMedia.productId, productId));
    await db.insert(schema.productMedia).values({ productId, url: saved.url, position: max + 1 });
    await db.insert(schema.media).values({ storeId: sid, url: saved.url, filename: file.name, mime: saved.mime, sizeBytes: saved.size, width: saved.width, height: saved.height });
  });

  revalidatePath("/produk");
  revalidatePath(`/produk/${productId}`);
  revalidatePath("/files");
}

export async function deleteProductImage(mediaId: string, productId: string): Promise<void> {
  const { storeId: sid } = await requireCapability("media:write");
  const url = await withTenant(sid, async (db) => {
    const [row] = await db.select({ url: schema.productMedia.url }).from(schema.productMedia).where(and(eq(schema.productMedia.id, mediaId), eq(schema.productMedia.productId, productId))).limit(1);
    if (!row) return null;
    await db.delete(schema.productMedia).where(eq(schema.productMedia.id, mediaId));
    return row.url;
  });
  // (leave the file + library entry — a file can be reused across products; managed from Files)
  revalidatePath("/produk");
  revalidatePath(`/produk/${productId}`);
}

// ---- media library (Files) ----
export type MediaItem = { id: string; url: string; filename: string; mime: string; sizeBytes: number; width: number | null; height: number | null; createdAt: Date };
export async function getMedia(): Promise<MediaItem[]> {
  const session = await getSession();
  if (!session) return [];
  return db.select().from(schema.media).where(eq(schema.media.storeId, session.storeId)).orderBy(desc(schema.media.createdAt));
}

export async function uploadMedia(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const { storeId: sid } = await requireCapability("media:write");
  const file = formData.get("file");
  try { checkFile(file); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "invalid" }; }
  const f = file as File;
  const saved = await saveImage(Buffer.from(await f.arrayBuffer()), f.type, `${sid.slice(0, 8)}-${Date.now()}`);
  await db.insert(schema.media).values({ storeId: sid, url: saved.url, filename: f.name, mime: saved.mime, sizeBytes: saved.size, width: saved.width, height: saved.height });
  revalidatePath("/files");
  return { ok: true };
}

export async function deleteMedia(id: string): Promise<{ ok: boolean }> {
  const { storeId: sid } = await requireCapability("media:write");
  const [row] = await db.select({ url: schema.media.url }).from(schema.media).where(and(eq(schema.media.id, id), eq(schema.media.storeId, sid))).limit(1);
  if (!row) return { ok: false };
  await db.delete(schema.media).where(and(eq(schema.media.id, id), eq(schema.media.storeId, sid)));
  await deleteImageFile(row.url);
  revalidatePath("/files");
  return { ok: true };
}
