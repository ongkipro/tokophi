"use server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_BYTES = 5 * 1024 * 1024;

// Upload one image to local storage (public/uploads/) and add a product_media row.
export async function uploadProductImage(productId: string, formData: FormData): Promise<void> {
  const { storeId: sid } = await requireCapability("media:write");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("no file");
  if (!file.type.startsWith("image/")) throw new Error("not an image");
  if (file.size > MAX_BYTES) throw new Error("file too large");

  const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = `${productId}-${Date.now()}.${ext}`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, name), Buffer.from(await file.arrayBuffer()));

  await withTenant(sid, async (db) => {
    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${schema.productMedia.position}), -1)`.mapWith(Number) })
      .from(schema.productMedia)
      .where(eq(schema.productMedia.productId, productId));
    await db.insert(schema.productMedia).values({ productId, url: `/uploads/${name}`, position: max + 1 });
  });

  revalidatePath("/produk");
  revalidatePath(`/produk/${productId}`);
}

// Remove a product_media row (and the local file if it was an upload).
export async function deleteProductImage(mediaId: string, productId: string): Promise<void> {
  const { storeId: sid } = await requireCapability("media:write");
  const url = await withTenant(sid, async (db) => {
    const [row] = await db.select({ url: schema.productMedia.url }).from(schema.productMedia).where(and(eq(schema.productMedia.id, mediaId), eq(schema.productMedia.productId, productId))).limit(1);
    if (!row) return null;
    await db.delete(schema.productMedia).where(eq(schema.productMedia.id, mediaId));
    return row.url;
  });
  if (url && url.startsWith("/uploads/")) {
    await fs.unlink(path.join(process.cwd(), "public", url)).catch(() => {});
  }
  revalidatePath("/produk");
  revalidatePath(`/produk/${productId}`);
}
