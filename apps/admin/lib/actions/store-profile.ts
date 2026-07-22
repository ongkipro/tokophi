"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { withCurrentTenant } from "@/lib/tenant";
import { saveImage, saveFavicon, deleteImageFile, MAX_BYTES } from "@/lib/image-store";
import { extractUsername, normalizePublicPhone, SOCIAL_PLATFORMS, type SocialPlatform } from "@/lib/social";
import { emailError } from "@tokophi/lib/validate";

// Store profile — the fields that actually have a column and reach the shopper's storefront:
// name, tagline (the storefront's meta description + footer line), whatsapp (the CS button).
//
// Pengaturan → Profil used to render these as hardcoded `defaultValue`s with no save wiring — a
// cosmetic form that looked editable and persisted nothing, and showed a placeholder WhatsApp number
// no shopper could reach. This makes them real.
//
// whatsapp/tagline are NULLABLE (migration 0049): a store that has not set a number renders NO
// WhatsApp button on its storefront (apps/storefront/src/data/store.ts) rather than a dead one. So
// clearing the field is a valid action, not an error — the button simply goes away.

// ⚠️ `address` here is the PUBLIC shop address — what a shopper sees in the storefront footer.
// It is NOT `store_settings.sender_address`, which is the SHIPPING PICKUP address that prices ongkir
// and tells the courier where to physically collect (Pengaturan → Alamat / Pengiriman). Do not
// reuse, mirror, prefill or sync the two. A merchant may ship from a warehouse while the shop is
// somewhere else, and most sellers here start from HOME — copying the pickup address into this field
// would publish a private home address on a public website without ever asking. They stay two
// separate columns, written by two separate forms, and this one is filled in deliberately or left
// empty. Empty is normal and correct.
//
// `phone` is likewise separate from `whatsapp`: plenty of shops publish a landline they do not run
// WhatsApp on, so one is not a default for the other. See lib/social.ts for why this field does NOT
// go through the shared `normalizePhone`.

export type SocialHandles = Record<SocialPlatform, string>;

export type StoreProfile = {
  name: string;
  tagline: string;
  whatsapp: string;
  address: string;
  phone: string;
  /** PUBLIC shop email — correspondence, NOT the owner's login (`users.email`). */
  email: string;
  social: SocialHandles;
  logoUrl: string | null;
  faviconUrl: string | null;
};

/** The `stores` column that backs each platform's handle. */
const SOCIAL_COLUMN = {
  instagram: "socialInstagram",
  tiktok: "socialTiktok",
  facebook: "socialFacebook",
  pinterest: "socialPinterest",
  x: "socialX",
} as const satisfies Record<SocialPlatform, keyof typeof schema.stores.$inferSelect>;

export async function getStoreProfile(): Promise<StoreProfile> {
  return withCurrentTenant(async (db, storeId) => {
    const [row] = await db
      .select({
        name: schema.stores.name,
        tagline: schema.stores.tagline,
        whatsapp: schema.stores.whatsapp,
        address: schema.stores.address,
        phone: schema.stores.phone,
        email: schema.stores.email,
        socialInstagram: schema.stores.socialInstagram,
        socialTiktok: schema.stores.socialTiktok,
        socialFacebook: schema.stores.socialFacebook,
        socialPinterest: schema.stores.socialPinterest,
        socialX: schema.stores.socialX,
        logoUrl: schema.stores.logoUrl,
        faviconUrl: schema.stores.faviconUrl,
      })
      .from(schema.stores)
      // Explicit, because RLS does NOT police `stores` (no store_id column, relrowsecurity = false).
      // Without this, `limit(1)` returned an arbitrary row — this form showed a STRANGER's shop name,
      // tagline and WhatsApp, and `saveStoreProfile` (which correctly writes `where id = storeId`)
      // would have written them onto this store the moment "Simpan Perubahan" was pressed. See
      // lib/tenant.ts.
      .where(eq(schema.stores.id, storeId))
      .limit(1);
    return {
      name: row?.name ?? "",
      tagline: row?.tagline ?? "",
      whatsapp: row?.whatsapp ?? "",
      address: row?.address ?? "",
      phone: row?.phone ?? "",
      email: row?.email ?? "",
      // NULL → "" so the inputs stay controlled. Every one of these is legitimately unset: a shop with
      // no TikTok renders no TikTok icon, which is honest — a link to a profile that does not exist is
      // worse than no link.
      social: Object.fromEntries(
        SOCIAL_PLATFORMS.map((p) => [p, row?.[SOCIAL_COLUMN[p]] ?? ""]),
      ) as SocialHandles,
      logoUrl: row?.logoUrl ?? null,
      faviconUrl: row?.faviconUrl ?? null,
    };
  });
}

// Indonesian mobile numbers, stored digits-only, country code first (62…) — the shape the storefront's
// wa.me link and the CRM already assume. Accepts what a merchant naturally types (08…, +62…, spaces,
// dashes) and normalises it, so the input is forgiving but the stored value is canonical.
function normalizeWa(input: string): string | null {
  var d = (input || "").replace(/[^0-9]/g, "");
  if (!d) return null; // cleared → NULL → no button (intentional)
  if (d.slice(0, 2) === "62") { /* already country code */ }
  else if (d[0] === "0") d = "62" + d.slice(1);
  else if (d[0] === "8") d = "62" + d;
  // 62 + 9..13 digits is the real Indonesian range; reject anything obviously not a phone number.
  return /^62[0-9]{8,13}$/.test(d) ? d : "invalid";
}

type Result = { ok: true } | { ok: false; error: string };
/** Upload returns the stored url — the server renames + re-encodes, so only it knows the final name. */
type BrandingResult = { ok: true; url: string } | { ok: false; error: string };

export async function saveStoreProfile(input: {
  name: string;
  tagline: string;
  whatsapp: string;
  address?: string;
  phone?: string;
  email?: string;
  social?: Partial<SocialHandles>;
}): Promise<Result> {
  const { storeId } = await requireCapability("settings:write");

  const name = (input.name || "").trim();
  if (!name) return { ok: false, error: "Nama toko wajib diisi." };
  if (name.length > 80) return { ok: false, error: "Nama toko terlalu panjang (maks. 80 karakter)." };

  const tagline = (input.tagline || "").trim();
  if (tagline.length > 160) return { ok: false, error: "Deskripsi terlalu panjang (maks. 160 karakter)." };

  const wa = normalizeWa(input.whatsapp);
  if (wa === "invalid") return { ok: false, error: "Nomor WhatsApp tidak valid. Contoh: 0812xxxxxxxx." };

  // PUBLIC shop address (storefront footer) — NOT the shipping pickup address. Multi-line on purpose:
  // an Indonesian address is 2–4 lines (jalan + no., RT/RW, kelurahan/kecamatan, kota + kode pos) and
  // flattening it into one line is how a shopper ends up unable to find the shop. Only the line
  // endings are normalised; the content is the merchant's to write.
  const address = (input.address ?? "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (address.length > 500) return { ok: false, error: "Alamat terlalu panjang (maks. 500 karakter)." };

  const phone = normalizePublicPhone(input.phone ?? "");
  if (phone === "invalid") return { ok: false, error: "Nomor telepon tidak valid." };

  // SHAPE ONLY, and reuse the checkout's rule rather than writing a second one (@tokophi/lib/validate).
  // No domain allow-list, ever: it would refuse corporate, university and self-hosted addresses —
  // which are the higher-value ones — and a merchant whose shop email is refused simply never fills
  // the field in. Empty is valid and is the normal case.
  const email = (input.email ?? "").trim();
  const emailProblem = email ? emailError(email) : null;
  if (emailProblem) return { ok: false, error: emailProblem };

  // Usernames only — a pasted profile URL is unpacked rather than refused (lib/social.ts). Nothing
  // beyond that is checked: the platforms' handle rules genuinely differ and a universal regex would
  // silently cost a merchant a channel.
  const social = Object.fromEntries(
    SOCIAL_PLATFORMS.map((p) => [SOCIAL_COLUMN[p], extractUsername(p, input.social?.[p] ?? "")]),
  );

  return withTenant(storeId, async (db) => {
    await db
      .update(schema.stores)
      // `where id = storeId` is REQUIRED, not belt-and-braces: `stores` is keyed by `id` and has no
      // `store_id`, so it is invisible to the store_id-based RLS derivation. 0058 put an id-based
      // policy on it, but the WHERE is the rule and the policy is only the net (see AGENTS.md).
      .set({ name, tagline: tagline || null, whatsapp: wa, address: address || null, phone, email: email || null, ...social })
      .where(eq(schema.stores.id, storeId));
    revalidatePath("/pengaturan");
    return { ok: true };
  });
}

// ── Branding: logo + favicon ──────────────────────────────────────────────────
//
// `stores.logo_url` was a column with READERS and NO WRITER: the storefront has always rendered the
// merchant's logo (Header.astro), fed it to the OG image (Layout.astro) and pulled it into checkout
// branding — while nothing, anywhere, could set it. Every shop fell back to a wordmark forever and no
// screen admitted a logo was even possible. `favicon_url` did not exist at all (0057), so every
// merchant's storefront served the PLATFORM's icon: a shop on its own domain wearing someone else's
// favicon reads as "this isn't really my site", which is precisely what a white-label builder is
// bought to avoid.
//
// Both are `settings:write` — only the Owner. Branding is store identity, not day-to-day content, and
// it lands on every page a shopper sees.
//
// The revalidate list is the whole point of the feature: the logo is chrome, so it appears on screens
// that never mention it. Revalidating only /pengaturan would save the file and leave the old logo on
// the topbar until something else happened to re-render.

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
// No SVG for the favicon: browsers' support is uneven and a broken tab icon is worse than a default
// one. PNG/WebP only — and it is rendered small, so this is not a real constraint on the merchant.
//
// ⚠️ NO ICO, and do not add it back without adding a decoder first. This list used to include
// "image/x-icon"/"image/vnd.microsoft.icon" and the file picker offered `.ico` to match — but every
// non-SVG upload goes through `saveImage`, which hands the bytes to **sharp, and sharp has no ICO
// decoder** (verified on 0.34.5: input formats are jpeg/png/webp/tiff/gif/svg/heif/vips/raw; even a
// PNG-in-ICO container throws "Input buffer contains unsupported image format"). So an .ico upload
// could only ever end at the catch below — a format we advertised in two places and rejected in a
// third. A PNG favicon is universally supported by browsers; ICO is legacy. Offer what works.
// Every raster format sharp can decode. A merchant should never have to convert a file by hand to
// give their shop a tab icon — whatever they have (a JPG from a designer, a PNG export, an AVIF off a
// phone) is squared to 512 and re-encoded as PNG by `saveFavicon`. That is the whole point: accept
// broadly, normalise once, serve one format.
// Verified against sharp 0.34.5's declared input formats — do not add a type sharp cannot decode, or
// it lands in the catch below as "tidak bisa dibaca" after we advertised it.
const FAVICON_TYPES = [
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/tiff", "image/heic", "image/heif",
];

/** The human-readable format list, derived from the allow-list so the message can never advertise a
 *  format the gate refuses. The two drifting apart is exactly how the ICO bug survived. */
const TYPE_LABELS: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/webp": "WebP",
  "image/svg+xml": "SVG",
};
function formatList(allowed: string[]): string {
  const names = allowed.map((t) => TYPE_LABELS[t] ?? t);
  if (names.length <= 1) return names.join("");
  // Two items take no comma in Indonesian — "PNG atau WebP", never "PNG, atau WebP".
  if (names.length === 2) return `${names[0]} atau ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, atau ${names[names.length - 1]}`;
}

async function setBranding(
  formData: FormData,
  field: "logoUrl" | "faviconUrl",
  allowed: string[],
  label: string,
): Promise<BrandingResult> {
  const { storeId } = await requireCapability("settings:write");
  const file = formData.get("file");
  // The boundary, not the form. `accept=` on an <input> is UX — a hand-rolled POST ignores it.
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: `Pilih berkas ${label} dulu.` };
  if (!allowed.includes(file.type)) return { ok: false, error: `Format ${label} harus ${formatList(allowed)}.` };
  if (file.size > MAX_BYTES) return { ok: false, error: `Ukuran ${label} maksimal 2 MB.` };

  let saved;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const base = `${field === "logoUrl" ? "logo" : "favicon"}-${storeId}-${Date.now()}`;
    // The favicon takes its own path: squared to 512 and written as PNG, because a tab icon is square
    // and PNG is the format every browser reads. `saveImage` would have made it a rectangular WebP.
    saved = field === "faviconUrl" ? await saveFavicon(buf, base) : await saveImage(buf, file.type, base);
  } catch {
    // sharp throws on a file that merely CLAIMS to be an image (a renamed .ico, a truncated PNG).
    // Report it as the merchant's problem to fix, never as a crash — and never write the DB row for a
    // file we failed to encode. The suggested formats come from the SAME allow-list that let the file
    // in, so this can never tell a merchant to retry with something we would also reject.
    return { ok: false, error: `Berkas ${label} tidak bisa dibaca. Coba ${formatList(allowed)}.` };
  }

  return withTenant(storeId, async (db) => {
    const [prev] = await db
      .select({ logoUrl: schema.stores.logoUrl, faviconUrl: schema.stores.faviconUrl })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId))
      .limit(1);
    await db.update(schema.stores).set({ [field]: saved.url }).where(eq(schema.stores.id, storeId));
    // Bin the file the row USED to point at — only after the new one is safely committed. Uploading a
    // logo ten times must not leave ten orphans on disk forever.
    await deleteImageFile(prev?.[field] ?? null);
    for (const p of ["/pengaturan", "/", "/akun/profil"]) revalidatePath(p);
    // Hand back the url the SERVER chose: it renames the file and re-encodes to WebP, so the client
    // cannot derive it and must not guess.
    return { ok: true, url: saved.url };
  });
}

export async function saveStoreLogo(formData: FormData): Promise<BrandingResult> {
  return setBranding(formData, "logoUrl", LOGO_TYPES, "logo");
}

export async function saveStoreFavicon(formData: FormData): Promise<BrandingResult> {
  return setBranding(formData, "faviconUrl", FAVICON_TYPES, "favicon");
}

/** Clearing is a real action, not an error: NULL means "not set" and the storefront falls back to the
 *  wordmark / platform icon — never to a broken image. Same rule as whatsapp/tagline (0049). */
async function clearBranding(field: "logoUrl" | "faviconUrl"): Promise<Result> {
  const { storeId } = await requireCapability("settings:write");
  return withTenant(storeId, async (db) => {
    const [prev] = await db
      .select({ logoUrl: schema.stores.logoUrl, faviconUrl: schema.stores.faviconUrl })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId))
      .limit(1);
    await db.update(schema.stores).set({ [field]: null }).where(eq(schema.stores.id, storeId));
    await deleteImageFile(prev?.[field] ?? null);
    for (const p of ["/pengaturan", "/", "/akun/profil"]) revalidatePath(p);
    return { ok: true };
  });
}

export async function removeStoreLogo(): Promise<Result> {
  return clearBranding("logoUrl");
}

export async function removeStoreFavicon(): Promise<Result> {
  return clearBranding("faviconUrl");
}
