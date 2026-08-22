"use server";
import { schema } from "@tokophi/db";
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
  // `|| null` and not `?? null`: an empty body is stored as NULL and read back as "" by
  // `data/pages.ts`, so an intentionally empty page round-trips as empty rather than acquiring
  // filler. Task 5.16 — the storefront already treats an empty body as a real state
  // (`page.body.trim() ? <Prose/> : …`); the editor must not disagree with it.
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

// Reports what it WROTE. This used to be `Promise<void>` over a blind UPDATE: RLS scopes the write
// to the session's store, so a page id that is gone — or was never ours — matches zero rows with no
// error, and the editor announced "Halaman tersimpan" over nothing. Same rule as `markLabelsPrinted`
// and the five writes fixed in #288; `.returning()` is the only honest source.
export async function updatePage(id: string, input: PageInput): Promise<{ ok: boolean; error?: string }> {
  const { storeId: sid } = await requireCapability("content:write");
  const rows = await withTenant(sid, (db) =>
    db.update(schema.pages).set(fields(input)).where(eq(schema.pages.id, id)).returning({ id: schema.pages.id }),
  );
  if (!rows.length) return { ok: false, error: "Halaman tidak ditemukan — mungkin sudah dihapus." };
  revalidatePath("/halaman");
  revalidatePath(`/halaman/${id}`);
  return { ok: true };
}

export async function deletePage(id: string): Promise<{ ok: boolean; error?: string }> {
  const { storeId: sid } = await requireCapability("content:write");
  const rows = await withTenant(sid, (db) =>
    db.delete(schema.pages).where(eq(schema.pages.id, id)).returning({ id: schema.pages.id }),
  );
  if (!rows.length) return { ok: false, error: "Halaman tidak ditemukan — mungkin sudah dihapus." };
  revalidatePath("/halaman");
  return { ok: true };
}
