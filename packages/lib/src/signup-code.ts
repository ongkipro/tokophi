// Signup codes (ADR 0019): a Super Admin-made code a self-serve signup may enter on /daftar (or arrive with
// as `?kode=`). Each code maps the new store to a shipping provider. ONE normaliser for every door — the
// /daftar form, the Google OAuth start route, the signup boundary (`provisionStore`) and Super Admin's
// editor — so the code an operator typed and the code a merchant typed compare equal.
//
// Canonical form = trimmed, upper-case, A-Z 0-9 and dash, 3–32 chars, starting with a letter or digit.
// The same shape is a CHECK on `signup_codes.code` (migration 0117); keep the two in step.

export const SIGNUP_CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

/**
 * `""` = no code entered (the normal case). `null` = something was entered but it cannot be a code —
 * the caller refuses it with the same sentence as an unknown code (never "looks malformed": that would
 * tell a prober which strings are worth trying). Otherwise the canonical code.
 */
export function normalizeSignupCode(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return "";
  return SIGNUP_CODE_RE.test(s) ? s : null;
}

/** The one sentence an unknown, inactive or malformed code gets — on the form and from the Google door. */
export const SIGNUP_CODE_UNKNOWN_MSG =
  "Kode daftar tidak dikenal atau sudah tidak berlaku. Periksa lagi kodenya, atau kosongkan kolomnya untuk daftar biasa.";
