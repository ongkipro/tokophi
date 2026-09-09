"use server";
import { schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant, withCurrentTenant } from "@/lib/tenant";
import type { PromoConfig, PromoContent } from "@/lib/data/promo";
import { resolveFormConfig } from "@tokophi/lib/form-config";
import { generateLandingCopy, promoAiEnabled, PROMO_AI_DISABLED_ID } from "@/lib/promo-ai";

// Clean a bullet/chip list: trim, drop blanks, cap the count and each length so a runaway paste can't
// bloat the row or the landing page.
function cleanList(xs: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(xs)) return [];
  return xs
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((s) => s.slice(0, maxLen));
}

const str = (v: unknown, maxLen: number): string | undefined => {
  const s = String(v ?? "").trim().slice(0, maxLen);
  return s || undefined;
};

function cleanContent(c: PromoContent | undefined): PromoContent {
  if (!c || typeof c !== "object") return {};
  return {
    problemTitle: str(c.problemTitle, 120),
    problemBullets: cleanList(c.problemBullets, 6, 240),
    agitation: str(c.agitation, 400),
    solutionTitle: str(c.solutionTitle, 120),
    solutionBody: str(c.solutionBody, 600),
    guarantee: str(c.guarantee, 400),
  };
}

export async function savePromoPage(productId: string, input: PromoConfig): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("content:write");

  const values = {
    enabled: !!input.enabled,
    headline: input.headline?.trim().slice(0, 120) || null,
    subheadline: input.subheadline?.trim().slice(0, 300) || null,
    badge: input.badge?.trim().slice(0, 40) || null,
    benefits: cleanList(input.benefits, 8, 120),
    idealFor: cleanList(input.idealFor, 12, 40),
    content: cleanContent(input.content),
    formConfig: resolveFormConfig(input.formConfig),
    // clamp 0..180 min; 0 = no countdown
    countdownMinutes: Math.max(0, Math.min(180, Math.round(Number(input.countdownMinutes) || 0))),
    showScarcity: !!input.showScarcity,
  };

  const res = await withTenant(storeId, async (db) => {
    // CHILD-TABLE RULE: promo_pages.product_id is an FK. Confirm the product is THIS store's (read it
    // back under RLS) before writing a row keyed on it — an INSERT under RLS would silently accept a
    // foreign product_id as long as store_id matches. Bail if the product isn't ours.
    const [prod] = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.id, productId), eq(schema.products.storeId, storeId)))
      .limit(1);
    if (!prod) return { ok: false as const, error: "Produk tidak ditemukan." };

    await db
      .insert(schema.promoPages)
      .values({ storeId, productId, ...values })
      .onConflictDoUpdate({
        target: [schema.promoPages.storeId, schema.promoPages.productId],
        set: { ...values, updatedAt: sql`now()` },
      });
    return { ok: true as const };
  });

  if (res.ok) {
    revalidatePath("/promo");
    revalidatePath(`/promo/${productId}`);
  }
  return res;
}

// Generate the whole landing copy with Claude, from the product's own data. Returns the draft for the
// editor to apply — it does NOT save. The merchant reviews, tweaks, and presses Simpan (savePromoPage).
// A regenerate simply overwrites the in-form draft; nothing is persisted until save.
export type GeneratedDraft = Partial<Pick<PromoConfig, "headline" | "subheadline" | "badge" | "benefits" | "idealFor" | "content">>;

export async function generatePromoContent(productId: string): Promise<{ ok: boolean; error?: string; draft?: GeneratedDraft }> {
  await requireCapability("content:write");

  // The editor already hides the button when the key is absent (Task 8.7). This is the boundary:
  // a server action takes its input from the client, so "the UI does not offer it" is never the gate.
  // Refused HERE, before the product read, so a disabled feature costs no query.
  if (!promoAiEnabled()) return { ok: false, error: PROMO_AI_DISABLED_ID };

  const product = await withCurrentTenant(async (db, storeId) => {
    const [p] = await db
      .select({
        name: schema.products.title,
        description: schema.products.description,
        category: schema.products.category,
        productType: schema.products.productType,
        price: schema.productVariants.priceIdr,
      })
      .from(schema.products)
      .leftJoin(
        schema.productVariants,
        and(eq(schema.productVariants.productId, schema.products.id), eq(schema.productVariants.position, 0)),
      )
      .where(and(eq(schema.products.id, productId), eq(schema.products.storeId, storeId)))
      .limit(1);
    return p ?? null;
  });
  if (!product) return { ok: false, error: "Produk tidak ditemukan." };

  const gen = await generateLandingCopy({
    name: product.name,
    description: product.description ?? "",
    category: product.category ?? product.productType ?? "",
    priceIdr: product.price ?? 0,
  });
  if (!gen.ok) return { ok: false, error: gen.error };

  // Sanitize the model output through the same cleaners the save path uses.
  return {
    ok: true,
    draft: {
      headline: str(gen.draft.headline, 120),
      subheadline: str(gen.draft.subheadline, 300),
      badge: str(gen.draft.badge, 40),
      benefits: cleanList(gen.draft.benefits, 8, 120),
      idealFor: cleanList(gen.draft.idealFor, 12, 40),
      content: cleanContent(gen.draft.content),
    },
  };
}
