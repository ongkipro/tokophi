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
const CONSENT = readFileSync(new URL("../components/admin/mengantar-consent.tsx", import.meta.url), "utf8");

describe("Mengantar consent is shown where the account is created", () => {
  it("the signup form renders the signup sentence — outside the step switch, so every step shows it", () => {
    // `codeOnly` re-joins tokens with single spaces (`/ >`, `</ form >`), hence the tolerant patterns.
    const at = SIGNUP.search(/<\s*MengantarConsent\s+action\s*=\s*"signup"\s*\/\s*>/);
    expect(at).toBeGreaterThan(-1);
    // After the closing form tag: not inside a `step === …` branch.
    expect(at).toBeGreaterThan(SIGNUP.search(/<\/\s*form\s*>/));
    // …and rendered unconditionally there: the token before it closes a JSX element. `{step === 2 && <M…/>}`
    // or `{x ? <M…/> : null}` after the form would hide it from the "Daftar dengan Google" step.
    // (`codeOnly` leaves a stripped JSX comment as an empty `{ }`.)
    expect(SIGNUP.slice(0, at).replace(/(\{\s*\}\s*)+$/, "").trimEnd()).toMatch(/>$/);
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
