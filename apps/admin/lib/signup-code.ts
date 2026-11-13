import "server-only";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { normalizeSignupCode } from "@tokophi/lib/signup-code";
import { DEFAULT_SHIPPING_PROVIDER, type ShippingProvider } from "@tokophi/lib/provider-config";

// ADR 0019 — read one ACTIVE signup code for the /daftar page (`?kode=` prefill) and the form's live check.
// OWNER pool on purpose: there is no session or tenant before signup, and `signup_codes` has RLS with no
// policy (0117), so the restricted role would read nothing. Advisory: `provisionStore` re-reads the code
// inside its own transaction, and that read is the boundary.
export async function lookupSignupCode(raw: unknown): Promise<{ code: string; provider: ShippingProvider } | null> {
  const code = normalizeSignupCode(raw);
  if (!code) return null;
  const [row] = await db
    .select({ provider: schema.signupCodes.shippingProvider })
    .from(schema.signupCodes)
    .where(and(eq(schema.signupCodes.code, code), eq(schema.signupCodes.active, true)))
    .limit(1);
  if (!row) return null;
  return { code, provider: row.provider === "mengantar" ? "mengantar" : DEFAULT_SHIPPING_PROVIDER };
}
