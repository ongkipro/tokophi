import "server-only";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { BILLING } from "@tokophi/lib/billing";

// Self-serve onboarding (Daftar + Google auto-provision). Mirrors the super-admin's
// `createStore` one-txn tenant bootstrap (account → user → store → membership → location →
// settings → stats). Both now stamp REAL timestamps: `createStore` used to write a frozen
// `ANCHOR = 2026-07-02` "for deterministic demo data", which made every store it provisioned read
// "30 hari lalu" on its first day and vanish from `newSignups30d`. Removed — the seed may be
// anchored; the app is not. Only difference left: this path is reached without a platform session.
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

/**
 * Self-serve signup master switch — CLOSED while the platform is still in development (2026-07-16).
 *
 * Fails CLOSED: registration is off unless `SIGNUP_ENABLED` is explicitly turned on, so a forgotten
 * env var can never quietly re-open the front door (same posture as `authSecret()`). To re-open, set
 * `SIGNUP_ENABLED=true` in Coolify and redeploy.
 *
 * This does NOT touch super-admin's own `createStore` — that is a different path, so we can still
 * onboard a merchant by hand while public signup is shut.
 */
export const signupOpen = () => /^(1|true|yes|on)$/i.test((process.env.SIGNUP_ENABLED ?? "").trim());

export class SignupClosedError extends Error {
  constructor() {
    super("Pendaftaran toko baru sedang ditutup sementara.");
    this.name = "SignupClosedError";
  }
}

/** Create account + owner user + store (3-day trial) + membership + default location/settings/stats — ONE txn. */
export async function provisionStore(input: ProvisionInput): Promise<ProvisionResult> {
  // THE boundary. Both self-serve paths — the /daftar form (registerStore) and the Google OAuth
  // callback — funnel through here, so closing the gate HERE closes both. Hiding the form would be
  // UX only: the server action and the OAuth callback would still happily create a store.
  if (!signupOpen()) throw new SignupClosedError();

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
        // ADR 0013 — a NEW store starts on the stable catalog id and therefore never pays the one-way
        // re-key that switching costs. The column defaults to 'handle' for stores that already exist
        // and may already have a catalog ingested somewhere; a store created now has none.
        catalogIdScheme: "number",
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
