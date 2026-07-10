"use server";
import { schema } from "@tokophi/db";
import type { Data } from "@measured/puck";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

// ADR 0009 — Store Builder. v1 ships the homepage builder end-to-end (single template,
// upsert-by-default-flag); category/product template variants (many-per-store, assignable
// per collection/product) are the tracked next step — see decisions/0009-self-serve-store-builder.md.
export async function saveHomepage(data: Data): Promise<void> {
  const { storeId } = await requireCapability("theme:write");
  await withTenant(storeId, async (db) => {
    const [existing] = await db
      .select({ id: schema.pageTemplates.id })
      .from(schema.pageTemplates)
      .where(and(eq(schema.pageTemplates.type, "homepage"), eq(schema.pageTemplates.isDefault, true)))
      .limit(1);
    if (existing) {
      await db
        .update(schema.pageTemplates)
        .set({ sections: data, updatedAt: new Date() })
        .where(eq(schema.pageTemplates.id, existing.id));
    } else {
      await db.insert(schema.pageTemplates).values({
        storeId,
        type: "homepage",
        name: "Beranda",
        sections: data,
        isDefault: true,
      });
    }
  });
  revalidatePath("/tema");
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Store-wide brand colour (ADR 0009 colour panel) — separate save from saveHomepage since
// it lives on `stores`, not `page_templates` (a theme-wide setting, not per-page content).
export async function saveBrandColor(hex: string): Promise<void> {
  if (!HEX_COLOR.test(hex)) throw new Error("Format warna tidak valid — gunakan hex 6 digit, mis. #a85572");
  const { storeId } = await requireCapability("theme:write");
  await withTenant(storeId, async (db) => {
    await db.update(schema.stores).set({ brandColor: hex }).where(eq(schema.stores.id, storeId));
  });
  revalidatePath("/tema");
}

export type PaletteInput = {
  id?: string;
  name: string;
  background: string;
  text: string;
  button: string;
  buttonText: string;
  accent: string;
};

function assertPaletteColors(p: PaletteInput) {
  for (const hex of [p.background, p.text, p.button, p.buttonText, p.accent]) {
    if (!HEX_COLOR.test(hex)) throw new Error("Format warna tidak valid — gunakan hex 6 digit, mis. #a85572");
  }
}

// "Palet Warna" (ADR 0009 amendment 2) — create (no `id`) or update (with `id`) one named palette.
export async function savePalette(input: PaletteInput): Promise<void> {
  assertPaletteColors(input);
  const { storeId } = await requireCapability("theme:write");
  await withTenant(storeId, async (db) => {
    if (input.id) {
      await db
        .update(schema.colorPalettes)
        .set({
          name: input.name,
          background: input.background,
          text: input.text,
          button: input.button,
          buttonText: input.buttonText,
          accent: input.accent,
        })
        .where(eq(schema.colorPalettes.id, input.id));
    } else {
      await db.insert(schema.colorPalettes).values({ storeId, ...input });
    }
  });
  revalidatePath("/tema");
}

export async function deletePalette(id: string): Promise<void> {
  const { storeId } = await requireCapability("theme:write");
  await withTenant(storeId, async (db) => {
    await db.delete(schema.colorPalettes).where(eq(schema.colorPalettes.id, id));
  });
  revalidatePath("/tema");
}
