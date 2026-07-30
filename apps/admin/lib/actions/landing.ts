"use server";
import { schema } from "@tokophi/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { can } from "@/lib/rbac-policy";
import { withTenant } from "@/lib/tenant";
import { resolveFormConfig, type FormConfig } from "@tokophi/lib/form-config";

export type LandingInput = {
  id?: string | null;
  slug: string;
  title: string;
  html: string;
  productId: string;
  enabled: boolean;
  countdownMinutes: number;
  showScarcity: boolean;
  formConfig: FormConfig;
};

const slugify = (s: string) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

export async function saveLanding(input: LandingInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  const session = await requireCapability("content:write");
  const { storeId } = session;

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
    formConfig: resolveFormConfig(input.formConfig),
  };

  const res = await withTenant(storeId, async (db) => {
    // ── RAW HTML IS OWNER-ONLY (2026-07-30 decision) ──────────────────────────────────────────────
    //
    // `lp/[slug].astro` renders this with `set:html`, which emits it into the SSR response BODY — the
    // browser's HTML parser handles it, not `innerHTML`, so a `<script>` tag in it RUNS. On the shop's
    // own origin, on the page that carries the COD order form. No sanitizer, no CSP.
    //
    // Gated on the HTML ACTUALLY CHANGING, not on the action: staff keep managing the title, slug,
    // product, countdown and funnel fields, which carry no such power. Escalating the whole editor
    // would take a capability away for a reason that does not apply to most of it.
    //
    // A regex sanitizer was considered and refused: `<script>` is the obvious vector and `onerror=`,
    // `javascript:` in an `href`, `<iframe srcdoc>` and SVG event handlers are not, so a partial strip
    // would restore exactly the false confidence the old "tidak dijalankan" caption was providing.
    const nextHtml = values.html;
    let priorHtml = "";
    if (input.id) {
      const [row] = await db
        .select({ html: schema.landingPages.html })
        .from(schema.landingPages)
        .where(and(eq(schema.landingPages.id, input.id), eq(schema.landingPages.storeId, storeId)))
        .limit(1);
      priorHtml = row?.html ?? "";
    }
    if (nextHtml !== priorHtml && !can(session.role, "landing:html")) {
      return {
        ok: false as const,
        error: "Hanya Pemilik toko yang boleh mengubah HTML landing — isinya dijalankan apa adanya di halaman toko.",
      };
    }

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
