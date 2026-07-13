import "server-only";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { BILLING } from "@tokophi/lib/billing";

// Self-serve onboarding (Daftar + Google auto-provision). Mirrors the super-admin's
// `createStore` one-txn tenant bootstrap (account → user → store → membership → location →
// settings → stats), with two differences:
//   • real timestamps (the super-admin seeds an ANCHOR date for deterministic demo data),
//   • a real trial: status "trial" + trialEndsAt = now + BILLING.TRIAL_DAYS (3 days).
// Runs on the OWNER connection — deliberate: there is no session/tenant yet, exactly like
// `lib/auth.ts` (RLS tenant scoping only applies to signed-in admin reads/writes).

export type ProvisionInput = {
  storeName: string;
  ownerName: string;
  email: string;
  passwordHash?: string | null;
  authProvider?: "password" | "google";
  googleSub?: string | null;
  /** Existing user (e.g. a Google account with no store yet) → reuse it instead of inserting one. */
  userId?: string;
};

export type ProvisionResult = {
  userId: string;
  storeId: string;
  role: string;
  email: string;
  name: string;
  slug: string;
};

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// Unique store slug: "batik-nusantara" → "batik-nusantara-2" → … (bounded, then random suffix).
async function uniqueSlug(base: string): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const [dup] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.slug, candidate))
      .limit(1);
    if (!dup) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function emailTaken(email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase().trim()))
    .limit(1);
  return Boolean(row);
}

/** Create account + owner user + store (3-day trial) + membership + default location/settings/stats — ONE txn. */
export async function provisionStore(input: ProvisionInput): Promise<ProvisionResult> {
  const email = input.email.toLowerCase().trim();
  const storeName = input.storeName.trim();
  const ownerName = input.ownerName.trim() || storeName;
  const base = slugify(storeName) || slugify(email.split("@")[0]) || "toko";
  const slug = await uniqueSlug(base);
  const trialEndsAt = new Date(Date.now() + BILLING.TRIAL_DAYS * 86_400_000);

  return db.transaction(async (tx) => {
    const [acc] = await tx.insert(schema.accounts).values({ name: storeName }).returning();
    const [u] = input.userId
      ? [{ id: input.userId }]
      : await tx
          .insert(schema.users)
          .values({
            email,
            name: ownerName,
            passwordHash: input.passwordHash ?? null,
            authProvider: input.authProvider ?? "password",
            googleSub: input.googleSub ?? null,
          })
          .returning({ id: schema.users.id });
    const [st] = await tx
      .insert(schema.stores)
      .values({
        accountId: acc.id,
        name: storeName,
        slug,
        status: "trial",
        trialEndsAt,
        firstInvoicePaid: false,
      })
      .returning();
    await tx.insert(schema.storeUsers).values({ storeId: st.id, userId: u.id, role: "owner", acceptedAt: new Date() });
    await tx.insert(schema.locations).values({ storeId: st.id, name: "Gudang Utama", isDefault: true });
    await tx.insert(schema.storeSettings).values({ storeId: st.id });
    await tx.insert(schema.storeStats).values({ storeId: st.id, gmvIdr: 0, ordersCount: 0, productsCount: 0 });
    await tx.insert(schema.platformActivity).values({
      kind: "signup",
      text: `Toko baru "${storeName}" mendaftar (${email})`,
      storeId: st.id,
    });
    return { userId: u.id, storeId: st.id, role: "owner", email, name: ownerName, slug };
  });
}
