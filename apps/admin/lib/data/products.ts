import "server-only";
import { db, schema } from "@indostore/db";
import { and, desc, eq } from "drizzle-orm";
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

function base() {
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
  const rows = await base().orderBy(desc(schema.products.createdAt));
  return rows.map(toProduct);
}

export async function getProduct(id: string): Promise<Product | null> {
  const rows = await base().where(eq(schema.products.id, id)).limit(1);
  return rows[0] ? toProduct(rows[0]) : null;
}
