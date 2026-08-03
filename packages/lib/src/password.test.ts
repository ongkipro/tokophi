import { readFileSync } from "node:fs";
import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { tempPassword, hashPassword } from "./password";

// This is the credential handed to a STORE OWNER and to an INVITED OPERATOR. The account it opens
// reads every buyer's name, WhatsApp number and delivery address, and reaches the payout actions.
//
// It used to be `"tokophi-" + randomBytes(3).toString("hex")` — **24 bits, 16,7 million candidates**
// — while `apps/admin` kept its own copy at `randomBytes(4)` (32 bits). Two implementations, and the
// weaker of the two was the one on the store-owner path. 24 bits is a real attack the moment the
// login door is unthrottled, and no login rate-limit was found (investigated under N18; deliberately
// NOT built here — it is an owner decision, see specs/docs/tasks/NEXT.md).
//
// ⚠️ THE FLOOR BELOW IS THE POINT OF THIS FILE. It is measured from what the generator actually
// EMITS — not read off a constant in `password.ts` — so shortening the string, narrowing the
// alphabet, or biasing the mapping all move the number. A future edit that makes this credential
// cheaper to guess must go red here.

const SAMPLES = 5_000;
const FLOOR_BITS = 48;

// Passwords that are public knowledge: the seed's, and anything ever shipped as a default.
const PUBLISHED = ["tokophi123", "tokophi", "password", "admin123"];

/** The longest prefix every sample shares — a fixed prefix carries no entropy and must not be counted. */
function commonPrefix(samples: string[]): string {
  let n = 0;
  while (samples.every((s) => s[n] !== undefined && s[n] === samples[0][n])) n++;
  return samples[0].slice(0, n);
}

describe("the temp password is expensive to guess", () => {
  const samples = Array.from({ length: SAMPLES }, () => tempPassword());

  it(`carries at least ${FLOOR_BITS} bits of min-entropy`, () => {
    const prefix = commonPrefix(samples);
    const bodies = samples.map((s) => s.slice(prefix.length));

    // A variable-length mint would make the arithmetic below a lie, and it is also a usability bug
    // (nobody can tell a truncated password from a short one). Refuse it outright.
    const lengths = new Set(bodies.map((b) => b.length));
    expect([...lengths], "the random part must be a fixed length").toHaveLength(1);
    const length = bodies[0].length;

    // MIN-entropy (−log2 of the most likely symbol), not Shannon: the attacker guesses the likeliest
    // candidates first, so the worst symbol is the one that decides the cost. Estimating it from
    // observed frequencies is what makes a biased mapping — `% 26` over a 26-letter alphabet, say —
    // score below its nominal alphabet size instead of being flattered by it.
    const counts = new Map<string, number>();
    for (const body of bodies) for (const ch of body) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const draws = SAMPLES * length;
    const pMax = Math.max(...counts.values()) / draws;
    const bits = length * -Math.log2(pMax);

    expect(
      bits,
      `only ${bits.toFixed(1)} bits: ${length} symbols over an observed alphabet of ${counts.size}`,
    ).toBeGreaterThanOrEqual(FLOOR_BITS);
  });

  it("is random per call, and never a published default", () => {
    // A constant (or a value derived from the input) collapses this to 1.
    const seen = new Set(samples);
    expect(seen.size).toBe(SAMPLES);
    for (const pw of seen) expect(PUBLISHED).not.toContain(pw);
  });

  it("a stored hash never verifies against a published password", () => {
    // What the attack actually is: knowing the merchant's email, try the default. scrypt is
    // deterministic per salt, so this is exactly the check `verifyPassword` runs at login.
    const stored = hashPassword(tempPassword());
    const [salt, hash] = stored.split(":");
    expect(salt).toHaveLength(32);
    for (const guess of PUBLISHED) {
      expect(scryptSync(guess, salt, 64).toString("hex"), `"${guess}" must not open the account`).not.toBe(hash);
    }
  });

  it("is the ONLY mint in the repo — no app keeps a private copy", () => {
    // THE regression this file exists to stop is not a weak number, it is a SECOND number. Both
    // surfaces must import the mint; a local `const tempPassword = …` is how the fix stops travelling.
    for (const rel of ["apps/admin/lib/actions/users.ts", "apps/super-admin/lib/actions.ts"]) {
      const src = readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");
      expect(src, `${rel} moved — repoint this test, do not delete it`).toContain("tempPassword");
      expect(src, `${rel} must import the shared mint`).toMatch(/import \{[^}]*tempPassword[^}]*\} from "@tokophi\/lib\/password"/);
      expect(src, `${rel} defines its own tempPassword — there must be exactly one`).not.toMatch(/(const|function) tempPassword/);
    }
  });
});
