// How this platform mints a login credential for SOMEONE ELSE'S account — a merchant's, an
// operator's, a store staffer's. There is exactly ONE implementation and this is it; both admin
// surfaces import from here. It is pure `node:crypto` (no DB, no `server-only`) for the same reason
// `platform-rank.ts` was split out of `platform-auth.ts`: the rule has to be testable.
//
// 🔴 THERE IS NO FIXED PASSWORD HERE AND THERE MUST NEVER BE ONE AGAIN.
// `createStore` used to hash the literal `tokophi123` — a string published in this repository and in
// AGENTS.md — into the OWNER row of every store an operator onboarded. Knowing the merchant's email
// address was therefore a working login at app.tokophi.com as the shop's owner: every order (buyer
// name, WhatsApp, full delivery address), every customer record, and `settings:write` over the bank
// account and payout actions. `invitePlatformAdmin` had already been fixed and its comment claimed
// "the store-user add flow already does it this way" — `createStore`, the path that creates the
// merchant, was still on the constant.
//
// The rule (AGENTS.md, "Super Admin — the control plane reaches every tenant"): **never mint a fixed
// password. Random per mint, revealed once.** Every caller must therefore surface what it returns —
// an action that mints a password the UI drops on the floor locks the merchant out instead.
//
// ⚠️ WHY IT LIVES IN packages/lib AND NOT IN AN APP: there used to be two of these, and they had
// already drifted — super-admin minted 3 random bytes (24 bits) while `apps/admin` minted 4 (32).
// The weaker one was the one on the store-owner path. A copy is how the weaker number survives a fix.
import { scryptSync, randomBytes } from "node:crypto";

// 32 symbols, 5 bits each. Crockford's base32 alphabet: the ten digits plus the letters minus
// `i`, `l`, `o` and `u` — the pairs a human confuses when reading a credential off a support screen
// (`l`/`1`, `o`/`0`) and the vowel that lets a random string spell something unfortunate. Lowercase
// throughout so nobody has to be told whether the case matters (it does — this is compared byte for
// byte by scrypt, and there is no normalisation on the login path).
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const LENGTH = 12;

/**
 * Passwords that are PUBLIC KNOWLEDGE and must never authenticate anything we mint.
 *
 * `tokophi123` was the seed's constant and was published in this repository, in `AGENTS.md`,
 * `README.md`, `specs/docs/SYSTEM_GUIDE.md` and on both login screens. It lives here, beside the mint,
 * because it has two consumers that would otherwise keep private copies: `password.test.ts` asserts no
 * minted credential can ever equal one of these, and `packages/db/src/seed.ts` refuses a
 * `SEED_OWNER_PASSWORD` that is one of them. Two lists is how the shorter one goes stale.
 */
export const PUBLISHED_PASSWORDS = ["tokophi123", "tokophi", "password", "admin123"] as const;

/** A fresh, unguessable temp password to hand over ONCE. Never a constant, never derived from input. */
export const tempPassword = (): string => {
  // `b & 31` is UNIFORM: 256 is a whole multiple of 32, so the low five bits of a random byte carry
  // no modulo bias. (`% ALPHABET.length` would be a bug the moment the alphabet stops being a power
  // of two — it silently over-weights the first symbols and quietly costs entropy.)
  let out = "";
  for (const b of randomBytes(LENGTH)) out += ALPHABET[b & 31];
  // The `tokophi-` prefix is worth ZERO bits — it exists so an operator reading the string aloud, or
  // finding it in a support thread, knows what it is. All the entropy is in the 12 symbols after it.
  return "tokophi-" + out;
};

/** scrypt `salt:hash` — the only form a password is ever stored in (matches `apps/admin/lib/auth.ts`). */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}
