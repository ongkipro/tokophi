import "server-only";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { BILLING } from "@tokophi/lib/billing";
import { NAME_MAX, STORE_NAME_MIN, isReservedSlug, slugify } from "@tokophi/lib/store-slug";
import { uniqueViolationConstraint } from "@tokophi/lib/pg-errors";

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

// `slugify` moved to `@tokophi/lib/store-slug` — super-admin's `createStore` had its OWN copy and the
// two had already drifted ("Café Senja" → `cafe-senja` here, `caf-senja` there). Re-exported because
// callers import it from this module.
export { slugify };

// Unique store slug: "batik-nusantara" → "batik-nusantara-2" → … (bounded, then random suffix).
//
// ⚠️ A RESERVED slug is skipped exactly like a TAKEN one. `RESERVED_SLUGS` is the storefront's own
// list of hostnames it refuses to resolve as a store (`app`, `rich`, `www`, `api`, …) — it was
// consulted on the way OUT and by nothing on the way IN, so a shop called "App" got `slug: "app"`
// and a storefront that 404s on its own subdomain, with no screen anywhere saying why. Falling
// through to `app-2` is the same answer this function already gives for a name someone else has.
async function uniqueSlug(base: string): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (isReservedSlug(candidate)) continue;
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

/**
 * A rule about the input, refused AT THE BOUNDARY so both self-serve paths obey it.
 *
 * The length rules lived in `registerStore` only — so the GOOGLE path, which takes the store name
 * from the Google profile and never touches that function, enforced NOTHING: a one-character display
 * name created a one-character shop, and there was no upper bound anywhere on either column
 * (`text()`, no cap, straight into `stores.name`, `accounts.name` and the `platform_activity` line
 * the control plane reads).
 *
 * `message` is merchant-facing Indonesian, because `registerStore` returns it to the form.
 */
export class ProvisionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisionInputError";
  }
}

/**
 * The email or the slug was taken BETWEEN our check and our INSERT.
 *
 * `emailTaken()` and `uniqueSlug()` are unlocked reads followed by a write, so two signups racing on
 * the same address (or the same shop name) both pass the check. Postgres refuses the second —
 * `users.email` and `stores.slug` are both `UNIQUE`, so the data is never wrong — but it surfaced as
 * an unhandled throw, i.e. a Next error digest, on a form that is otherwise careful to return a
 * sentence the person can act on. The constraint is the lock; this is how the lock reports itself.
 */
export class ProvisionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisionConflictError";
  }
}

export const EMAIL_TAKEN_MSG = "Email sudah terdaftar. Silakan masuk.";
const SLUG_TAKEN_MSG = "Nama toko itu baru saja dipakai. Coba nama lain sedikit.";

/**
 * Constraint name → the sentence a person can act on.
 *
 * ⚠️ These strings come from the MIGRATIONS, not from `schema.ts` prose — drizzle derives
 * `<table>_<column>_unique` from a column-level `.unique()`. They are pinned by
 * `packages/db/src/provision-conflicts.test.ts`, which provokes BOTH violations against the real test
 * database, so a rename lands as a red test instead of as an unexplained 500 on the signup form.
 */
const CONFLICT_MESSAGES: Record<string, string> = {
  users_email_unique: EMAIL_TAKEN_MSG,
  stores_slug_unique: SLUG_TAKEN_MSG,
};

/** Create account + owner user + store (3-day trial) + membership + default location/settings/stats — ONE txn. */
export async function provisionStore(input: ProvisionInput): Promise<ProvisionResult> {
  // THE boundary. Both self-serve paths — the /daftar form (registerStore) and the Google OAuth
  // callback — funnel through here, so closing the gate HERE closes both. Hiding the form would be
  // UX only: the server action and the OAuth callback would still happily create a store.
  if (!signupOpen()) throw new SignupClosedError();

  const email = input.email.toLowerCase().trim();
  const storeName = input.storeName.trim();
  const ownerName = input.ownerName.trim() || storeName;

  // Both bounds, at the boundary — see `ProvisionInputError`. The floor was in `registerStore` only
  // and the ceiling was nowhere.
  if (storeName.length < STORE_NAME_MIN) {
    throw new ProvisionInputError(`Nama toko minimal ${STORE_NAME_MIN} karakter.`);
  }
  if (storeName.length > NAME_MAX) throw new ProvisionInputError(`Nama toko maksimal ${NAME_MAX} karakter.`);
  if (ownerName.length > NAME_MAX) throw new ProvisionInputError(`Nama pemilik maksimal ${NAME_MAX} karakter.`);

  const base = slugify(storeName) || slugify(email.split("@")[0]) || "toko";
  const slug = await uniqueSlug(base);
  const trialEndsAt = new Date(Date.now() + BILLING.TRIAL_DAYS * 86_400_000);

  try {
    return await insertTenant({ input, email, storeName, ownerName, slug, trialEndsAt });
  } catch (e) {
    // The check-then-insert races, caught where the DB actually decides them.
    const constraint = uniqueViolationConstraint(e);
    if (constraint !== null) throw new ProvisionConflictError(CONFLICT_MESSAGES[constraint] ?? SLUG_TAKEN_MSG);
    throw e;
  }
}

type InsertTenantArgs = {
  input: ProvisionInput;
  email: string;
  storeName: string;
  ownerName: string;
  slug: string;
  trialEndsAt: Date;
};

async function insertTenant({
  input,
  email,
  storeName,
  ownerName,
  slug,
  trialEndsAt,
}: InsertTenantArgs): Promise<ProvisionResult> {
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
