"use server";
import { schema } from "@tokophi/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

export type LandingInput = {
  id?: string | null;
  slug: string;
  title: string;
  html: string;
  productId: string;
  enabled: boolean;
  countdownMinutes: number;
  showScarcity: boolean;
};

const slugify = (s: string) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

export async function saveLanding(input: LandingInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { storeId } = await requireCapability("content:write");

  const slug = slugify(input.slug);
  const title = input.title.trim().slice(0, 160);
  if (!slug) return { ok: false, error: "Slug wajib diisi (huruf/angka/tanda hubung)." };
  if (!title) return { ok: false, error: "Judul wajib diisi." };
  if (!input.productId) return { ok: false, error: "Pilih produk untuk checkout." };

  const values = {
    slug,
    title,
    html: input.html ?? "",
    productId: input.productId,
    enabled: !!input.enabled,
    countdownMinutes: Math.max(0, Math.min(180, Math.round(Number(input.countdownMinutes) || 0))),
    showScarcity: !!input.showScarcity,
  };

  const res = await withTenant(storeId, async (db) => {
    // CHILD-TABLE RULE: product_id is an FK on a table with no independent identity — confirm the
    // product is THIS store's (read back under RLS) before writing a row keyed on it.
    const [prod] = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.id, input.productId), eq(schema.products.storeId, storeId)))
      .limit(1);
    if (!prod) return { ok: false as const, error: "Produk tidak ditemukan." };

    // Slug must be unique within the store (it is the URL). Reject a clash with a DIFFERENT landing.
    const clash = await db
      .select({ id: schema.landingPages.id })
      .from(schema.landingPages)
      .where(
        and(
          eq(schema.landingPages.storeId, storeId),
          eq(schema.landingPages.slug, slug),
          input.id ? ne(schema.landingPages.id, input.id) : sql`true`,
        ),
      )
      .limit(1);
    if (clash.length) return { ok: false as const, error: `Slug "${slug}" sudah dipakai landing lain.` };

    if (input.id) {
      await db
        .update(schema.landingPages)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.landingPages.id, input.id));
      return { ok: true as const, id: input.id };
    }
    const [row] = await db
      .insert(schema.landingPages)
      .values({ storeId, ...values })
      .returning({ id: schema.landingPages.id });
    return { ok: true as const, id: row.id };
  });

  if (res.ok) {
    revalidatePath("/promo");
    revalidatePath(`/promo/html/${res.id}`);
  }
  return res;
}

export async function deleteLanding(id: string): Promise<void> {
  const { storeId } = await requireCapability("content:write");
  await withTenant(storeId, (db) => db.delete(schema.landingPages).where(eq(schema.landingPages.id, id)));
  revalidatePath("/promo");
}
