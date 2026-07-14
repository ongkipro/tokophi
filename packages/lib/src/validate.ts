// ─────────────────────────────────────────────────────────────────────────────
// Checkout input: NORMALISE GENEROUSLY, REJECT NARROWLY.
//
// Every rule here can cost a sale, and it costs it SILENTLY — a shopper whose real name, real new
// carrier prefix or real address is refused does not file a bug, they leave. So the bar for
// rejecting is "this cannot possibly be a real Indonesian customer", not "this is not how I would
// have typed it". Anything that can be repaired is repaired (`normalize*`), and only what is
// structurally impossible is refused (`*Error`).
//
// This module is PURE (no DB, no server-only imports) on purpose: the same rules run in the
// storefront's checkout for early feedback and in `/api/public/order`, which is the actual boundary.
// The form is UX; the API decides. A claim from the client is not a fact.
// ─────────────────────────────────────────────────────────────────────────────

/** Every error message is Bahasa Indonesia — it is shown to the shopper verbatim. */
export type FieldError = string | null;

// ── WhatsApp ────────────────────────────────────────────────────────────────────────────────────
// Canonical form is `62xxxxxxxxx` — what KiriminAja expects on a booking and what the Seller admin
// should display. Prod stored `08124612804` (24/24 customers), so this is a data-normalisation job
// first and a form rule second: accept anything a human types, store one shape.
//
// Structure, NOT carrier. After `62` the national number must start with `8` and be 9–12 digits
// (i.e. the familiar local form `08…` is 10–13 digits). We deliberately do NOT check the operator
// prefix (811/812/813/821/85x/89x/…): carriers add prefixes, and a hard-coded list would one day
// refuse a real customer holding a brand-new number — a silent, permanent, unfindable bug. A
// structural rule catches fakes; a prefix table only catches yesterday's fakes.
const PHONE_MIN_NATIONAL = 9; // 8xxxxxxxx      → 0 8xxxxxxxx  = 10 digits local
const PHONE_MAX_NATIONAL = 12; // 8xxxxxxxxxxx  → 0 8xxxxxxxxxxx = 13 digits local

/**
 * `0812-4612-804`, `+62 812 4612 804`, `812.4612.804`, `62 812 4612 804` → `628124612804`.
 * Returns null when it cannot be a valid Indonesian mobile number.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  // Keep digits only. A leading "+" carries no information once we know the country code, and every
  // separator a human might use (space, dot, dash, brackets, non-breaking space) is noise.
  let d = String(raw).replace(/\D+/g, "");
  if (!d) return null;

  // Trunk/country prefixes, longest first. `0` is the Indonesian trunk prefix; `62` the country
  // code. `620…` happens when someone concatenates both — repair it rather than refuse it.
  if (d.startsWith("620")) d = d.slice(3);
  else if (d.startsWith("62")) d = d.slice(2);
  else if (d.startsWith("0")) d = d.replace(/^0+/, "");
  // else: bare national number ("812…") — the third shape people type.

  if (!d.startsWith("8")) return null; // Indonesian mobiles are 8xx. A landline cannot receive WA.
  if (d.length < PHONE_MIN_NATIONAL || d.length > PHONE_MAX_NATIONAL) return null;
  return "62" + d;
}

export function phoneError(raw: unknown): FieldError {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "Nomor WhatsApp wajib diisi.";
  if (!normalizePhone(s)) return "Nomor WhatsApp tidak valid. Contoh: 08123456789.";
  return null;
}

// ── Email (OPTIONAL, shape only) ────────────────────────────────────────────────────────────────
// There is no mailer in this repo, so we can check the SHAPE and must never promise delivery.
// NO domain whitelist: a gmail/yahoo allow-list would reject corporate, university and self-hosted
// addresses — precisely the higher-value buyers. Suggestions are fine; a block is not.
const EMAIL_RE = /^[^\s@,;:<>()[\]\\"]+@[^\s@.,;:<>()[\]\\"]+(\.[^\s@.,;:<>()[\]\\"]+)+$/u;

export function normalizeEmail(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  // Only the domain is case-insensitive by spec, but no real store treats the local part as
  // case-sensitive, and lowercasing is what makes the "same customer" lookup work.
  return s.toLowerCase();
}

/** Empty is VALID — email is optional at checkout (kept for a future account / mailing list). */
export function emailError(raw: unknown): FieldError {
  const s = normalizeEmail(raw);
  if (!s) return null;
  if (s.length > 254) return "Email terlalu panjang.";
  if (!EMAIL_RE.test(s)) return "Format email tidak valid. Contoh: nama@email.com.";
  return null;
}

// ── Nama ────────────────────────────────────────────────────────────────────────────────────────
// Indonesian names carry apostrophes (`Nur'aini`), dots (`M. Rizky`), hyphens and plenty of spaces
// (`Siti Aisyah binti Abdullah`). Letters are matched with \p{L}, so diacritics and non-Latin
// scripts pass — rejecting `Sinaga Hutabarat` because of an accent would be an own goal. Digits and
// symbols are refused: that is what junk and injection attempts look like.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’\-]*$/u;

export function normalizeName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}

export function nameError(raw: unknown): FieldError {
  const s = normalizeName(raw);
  if (!s) return "Nama lengkap wajib diisi.";
  if (s.length < 2) return "Nama terlalu pendek.";
  if (s.length > 80) return "Nama terlalu panjang (maks. 80 karakter).";
  if (/\d/.test(s)) return "Nama tidak boleh mengandung angka.";
  if (!NAME_RE.test(s)) return "Nama hanya boleh berisi huruf, spasi, titik, apostrof, dan tanda hubung.";
  return null;
}

// ── Alamat lengkap ──────────────────────────────────────────────────────────────────────────────
// Digits are the POINT (house number, RT/RW, blok), so an address is letters AND digits plus the
// punctuation people actually write (`Jl. Melati No. 12, RT 03/RW 05, Blok A-2`). We block only
// what cannot be an address: control characters, emoji, and a "one character mashed repeatedly"
// string. Plus a sane minimum length so `-` is not an address.
const CONTROL_RE = /[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/u;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

export function normalizeAddress(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    // A <textarea> submits CRLF. The line break itself is meaningful (street / RT-RW / patokan sit on
    // separate lines), so it becomes ", " — but the carriage return is not, and must not trip the
    // control-character check below.
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\s*\n+\s*/g, ", ")
    .trim();
}

export function addressError(raw: unknown): FieldError {
  const s = normalizeAddress(raw);
  if (!s) return "Alamat lengkap wajib diisi.";
  if (s.length < 10) return "Alamat terlalu pendek — tulis nama jalan, no. rumah, RT/RW.";
  if (s.length > 300) return "Alamat terlalu panjang (maks. 300 karakter).";
  if (CONTROL_RE.test(s) || EMOJI_RE.test(s)) return "Alamat mengandung karakter yang tidak didukung.";
  // "aaaaaaaaaa" / "----------" — long enough to pass the length check, and still not an address.
  const distinct = new Set(s.replace(/\s+/g, "").toLowerCase()).size;
  if (distinct < 4) return "Alamat tidak valid — tulis alamat lengkapmu.";
  // At least a few letters: a run of digits is a phone number someone pasted, not an address.
  if ((s.match(/\p{L}/gu) ?? []).length < 4) return "Alamat tidak valid — tulis alamat lengkapmu.";
  return null;
}

// ── Kode pos ────────────────────────────────────────────────────────────────────────────────────
// Auto-filled from the picked kelurahan, but it stays TYPEABLE for the ~4% of districts with no
// kelurahan data — that path must never block an order. Optional, and exactly 5 digits when given.
export function normalizePostcode(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\D+/g, "").slice(0, 5) : "";
}

export function postcodeError(raw: unknown): FieldError {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null; // optional
  if (!/^\d{5}$/.test(s)) return "Kode pos harus 5 angka.";
  return null;
}

// ── Kecamatan ───────────────────────────────────────────────────────────────────────────────────
// There is deliberately NO character rule here. The kecamatan is PICKED FROM A LIST, so the real
// (and far stronger) check is: the `dest_id` must resolve in `kiriminaja_areas`. That is the id the
// parcel is booked against and the id the ongkir price was built from — a character rule on the
// display text proves nothing about either. The resolution lives server-side
// (`apps/admin/lib/data/areas.ts` → `areaById`), because only the server can do it honestly.
export function destIdError(raw: unknown): FieldError {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "Pilih kecamatan tujuan dari daftar.";
  return null;
}
