// Store affiliate programme — storefront half (Task 9.5, specs/AFFILIATE_SPEC.md F-A1/F-A2). The store id
// always comes from the Host-resolved `locals.store`, never from the form.
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { suggestAffiliateCode } from "@tokophi/lib/affiliate";

export type AffiliateApplication = {
  name: string;
  /** Canonical `62…` (normalizePhone) — the caller validates before calling. */
  phone: string;
  email: string | null;
  channel: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
};

/** `created` = a new `menunggu` row; `exists` = this phone already applied/joins this store; `failed` = no unique code. */
export async function applyAffiliate(storeId: string, a: AffiliateApplication): Promise<"created" | "exists" | "failed"> {
  const [dupe] = await db
    .select({ id: schema.affiliates.id })
    .from(schema.affiliates)
    .where(and(eq(schema.affiliates.storeId, storeId), eq(schema.affiliates.phone, a.phone)))
    .limit(1);
  if (dupe) return "exists";
  // The per-store unique (store_id, code) decides a clash; a generated code just tries again.
  for (let i = 0; i < 5; i++) {
    const rows = await db
      .insert(schema.affiliates)
      .values({
        storeId,
        code: suggestAffiliateCode(a.name),
        name: a.name,
        phone: a.phone,
        email: a.email,
        bankName: a.bankName,
        bankAccount: a.bankAccount,
        bankHolder: a.bankHolder,
        note: a.channel,
      })
      .onConflictDoNothing()
      .returning({ id: schema.affiliates.id });
    if (rows.length) return "created";
  }
  return "failed";
}
