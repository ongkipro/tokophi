import "server-only";
import { schema } from "@indostore/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { and, desc, eq, ne } from "drizzle-orm";
import type { Product } from "@/lib/mock/store";

// Flatten the normalized catalog (products ⋈ default variant ⋈ inventory ⋈ primary media)
// back into the admin's flat `Product` shape — signatures unchanged, screens untouched.
const selectProduct = {
  id: schema.products.id,
  name: schema.products.title,
  emoji: schema.products.emoji,
  status: schema.products.status,
  category: schema.products.category,
  unitsSold: schema.products.unitsSold,
  createdAt: schema.products.createdAt,
  price: schema.productVariants.priceIdr,
  stock: schema.inventoryLevels.available,
  image: schema.productMedia.url,
};

function base(db: Tx) {
  return db
    .select(selectProduct)
    .from(schema.products)
    .leftJoin(schema.productVariants, and(eq(schema.productVariants.productId, schema.products.id), eq(schema.productVariants.position, 0)))
    .leftJoin(schema.inventoryLevels, eq(schema.inventoryLevels.variantId, schema.productVariants.id))
    .leftJoin(schema.productMedia, and(eq(schema.productMedia.productId, schema.products.id), eq(schema.productMedia.position, 0)));
}

function toProduct(r: {
  id: string; name: string; emoji: string | null; status: "active" | "draft" | "archived";
  category: string | null; unitsSold: number; createdAt: Date; price: number | null; stock: number | null; image: string | null;
}): Product {
  return {
    id: r.id,
    name: r.name,
    emoji: r.emoji ?? "📦",
    image: r.image ?? `/products/${r.name}.webp`,
    price: r.price ?? 0,
    stock: r.stock ?? 0,
    status: r.status === "draft" ? "draft" : "active",
    category: r.category ?? "",
    unitsSold: r.unitsSold,
    addedTs: r.createdAt.getTime(),
  };
}

export async function getProducts(): Promise<Product[]> {
  return withCurrentTenant(async (db) => {
    const rows = await base(db).where(ne(schema.products.status, "archived")).orderBy(desc(schema.products.createdAt));
    return rows.map(toProduct);
  });
}

export async function getProduct(id: string): Promise<Product | null> {
  return withCurrentTenant(async (db) => {
    const rows = await base(db).where(eq(schema.products.id, id)).limit(1);
    if (!rows[0]) return null;
    const media = await db
      .select({ id: schema.productMedia.id, url: schema.productMedia.url })
      .from(schema.productMedia)
      .where(eq(schema.productMedia.productId, id))
      .orderBy(schema.productMedia.position);
    return { ...toProduct(rows[0]), media };
  });
}
