import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// THE OWNER'S AGREEMENT IS SHOWN WHERE THE ACCOUNT IS CREATED (Mengantar Partner docs: "Get their agreement to
// the Mengantar Terms and Conditions and Privacy Policy … it has to happen on your side").
// Server side, `connectStoreMengantar` refuses to register without recorded consent
// (mengantar-account.test.ts "no owner consent …"); consent is recorded only by signup and by the Pengaturan
// click. This file pins the other half: those two screens actually SHOW the sentence. `codeOnly` — a
// commented-out <MengantarConsent> must not keep this green.
const read = (p: string) => codeOnly(readFileSync(new URL(p, import.meta.url), "utf8"));
const SIGNUP = read("../app/daftar/daftar-form.tsx");
const CARD = read("../components/admin/pengaturan/mengantar-card.tsx");
const ACTIONS = read("./actions/mengantar.ts");
const REGISTER = read("./actions/register.ts");
const PROVISION = read("./provision.ts");
const CONSENT = readFileSync(new URL("../components/admin/mengantar-consent.tsx", import.meta.url), "utf8");

// ── Signup (ADR 0019) ────────────────────────────────────────────────────────────────────────────
// A Mengantar account is created ONLY for a store a Mengantar signup code puts on Mengantar, so the
// sentence appears ONLY for such a code — and a store without one sees no provider brand (ADR 0004).
// Each predicate is a function so the mutation test below can prove it red on a broken copy.
// `codeOnly` re-joins tokens with single spaces (`/ >`, `</ form >`, `?.`), hence the tolerant patterns.

/** The sentence sits after `</form>` (so on every step, the Google button's included) and its ONLY
 *  condition is `consentShown`. A `{step === 2 && …}` wrapper would hide it from the Google step. */
function sentenceOutsideFormOnConsentShown(src: string): boolean {
  const at = src.search(/\{\s*consentShown\s*\?\s*\(\s*<\s*MengantarConsent\s+action\s*=\s*"signup"\s*\/\s*>/);
  if (at < 0 || at < src.search(/<\/\s*form\s*>/)) return false;
  // …and that conditional is itself rendered unconditionally (the token before it closes a JSX element).
  return /\>$/.test(src.slice(0, at).replace(/(\{\s*\}\s*)+$/, "").trimEnd());
}
/** `consentShown` is the code's own answer (the server's lookup), nothing the person can toggle. */
const shownOnlyForAMengantarCode = (src: string) => /const\s+consentShown\s*=\s*!\s*!\s*current\s*\?\.\s*mengantar\s*;/.test(src);
/** The hidden field posts the code the sentence was shown FOR — and nothing while it is not shown. */
const consentBoundToTheCode = (src: string) => /name\s*=\s*"mengantarConsentFor"\s+value\s*=\s*\{\s*consentShown\s*&&\s*norm\s*\?\s*norm\s*:\s*""\s*\}/.test(src);
/** The other branch names no provider at all. */
function elseBranchNamesNoProvider(src: string): boolean {
  const from = src.search(/\{\s*consentShown\s*\?/);
  if (from < 0) return false;
  const tail = src.slice(from);
  const elseAt = tail.search(/\)\s*:\s*\(/);
  if (elseAt < 0) return false;
  const branch = tail.slice(elseAt, tail.indexOf(") }", elseAt + 3));
  return branch.length > 0 && !/mengantar|kiriminaja/i.test(branch);
}

describe("Mengantar consent is shown where the account is created", () => {
  it("signup: the sentence renders outside the step switch, only for a code that maps to Mengantar, bound to that code", () => {
    expect(sentenceOutsideFormOnConsentShown(SIGNUP)).toBe(true);
    expect(shownOnlyForAMengantarCode(SIGNUP)).toBe(true);
    expect(consentBoundToTheCode(SIGNUP)).toBe(true);
    expect(elseBranchNamesNoProvider(SIGNUP)).toBe(true);
  });

  it("signup: the server counts consent only when it was shown for THIS code, and registers only a Mengantar store", () => {
    // register.ts — the posted `mengantarConsentFor` must equal the submitted code.
    expect(REGISTER).toMatch(/mengantarConsent\s*=\s*!\s*!\s*consentFor\s*&&\s*consentFor\s*===\s*normalizeSignupCode\s*\(\s*signupCode\s*\)/);
    // provision.ts — no account for a KiriminAja store; no consent recorded without the flag.
    expect(PROVISION).toMatch(/if\s*\(\s*r\s*\.\s*shippingProvider\s*===\s*"[^"]*"\s*\)\s*\{\s*await\s+enqueueMengantarConnect\s*\(\s*r\s*\.\s*storeId\s*,\s*\{[^}]*actorUserId\s*:\s*input\s*\.\s*mengantarConsent\s*\?\s*r\s*\.\s*userId\s*:\s*null/);
  });

  it("the signup guards fire against mutated copies of the form", () => {
    const unconditional = SIGNUP.replace(/\{\s*consentShown\s*\?\s*\(\s*<\s*MengantarConsent/, "{ true ? ( < MengantarConsent");
    expect(sentenceOutsideFormOnConsentShown(unconditional)).toBe(false);
    const stepOnly = SIGNUP.replace(/\{\s*consentShown\s*\?/, "{ step === 2 && consentShown ?");
    expect(sentenceOutsideFormOnConsentShown(stepOnly)).toBe(false);
    expect(shownOnlyForAMengantarCode(SIGNUP.replace(/!\s*!\s*current\s*\?\.\s*mengantar/, "true"))).toBe(false);
    expect(consentBoundToTheCode(SIGNUP.replace(/value\s*=\s*\{\s*consentShown\s*&&\s*norm\s*\?\s*norm/, "value = { norm ? norm"))).toBe(false);
    expect(elseBranchNamesNoProvider(SIGNUP.replace(/Sebelum membuat toko/, "Pengiriman lewat Mengantar"))).toBe(false);
  });

  it("the Pengaturan card renders the connect sentence whenever a connect button can be pressed", () => {
    expect(CARD).toMatch(/\{\s*canConnect\s*&&\s*<\s*MengantarConsent\s+action\s*=\s*"connect"\s*\/\s*>\s*\}/);
    expect(CARD).toMatch(/\{\s*canConnect\s*&&\s*\(\s*<\s*Button/);
  });

  it("links Mengantar's own Terms and Privacy pages (verified live 2026-11-11)", () => {
    expect(CONSENT).toContain('"https://www.mengantar.com/terms/"');
    expect(CONSENT).toContain('"https://www.mengantar.com/privacy-policy/"');
    expect(CONSENT).toMatch(/rel="noopener noreferrer"/);
  });

  it("the click records consent only from the owner — never from an operator in \"Buka Dashboard Seller\"", () => {
    // Impersonation carries the merchant's role AND user id, so requireCapability passes and consent would
    // be written in the owner's name. The refusal must come before anything that registers or requeues.
    const body = ACTIONS.slice(ACTIONS.search(/export\s+async\s+function\s+connectMengantar\s*\(/));
    const imp = body.search(/if\s*\(\s*session\s*\.\s*imp\s*\)\s*return\s*\{\s*ok\s*:\s*false/);
    expect(imp).toBeGreaterThan(-1);
    for (const call of [/requeueMengantar\s*\(/, /connectStoreMengantar\s*\(/]) expect(imp).toBeLessThan(body.search(call));
  });
});
