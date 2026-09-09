// Page-map report SF-4 / SF-6 / SF-7 — the three findings closed in `keranjang.astro`,
// `thanks.astro` and `checkout.astro` on 2026-09-09. Every one of them is the ABSENCE of something,
// which is precisely the shape no type-checker, lint rule or build has an opinion about: put the
// sentence back and `astro check`, eslint and `npm run build` all stay green while the shop lies to
// a shopper again.
//
// SF-4 is the class this repo keeps paying for: ONE storefront container serves EVERY merchant
// (ADR 0009), so a per-tenant fact written into the markup is one merchant's truth published as
// every store's. `kontak-email.test.ts` pins the same class on /kontak (the hard-coded address, then
// the hard-coded opening hours); this file pins the cart's payment claim and /thanks's presence pill.
//
// Views chosen per assertion (`test/source-code.ts`):
//   · "the page no longer EMITS this sentence"  → textWithoutComments — the sentence lives inside a
//     string/text node, and `codeOnly` inerts a literal's contents, so a codeOnly claim here would be
//     permanently green over the exact bug it hunts.
//   · "the page EXECUTES this derivation"       → codeOnly — a commented-out `enabledPaymentChannels`
//     call must not keep it green (that defect has been found nine times in this repo).
// Both views join tokens with single spaces, so every pattern below is whitespace-tolerant.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly, textWithoutComments } from "../../../../test/source-code";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const cartRaw = read("../pages/keranjang.astro");
const thanksRaw = read("../pages/thanks.astro");
const checkoutRaw = read("../pages/checkout.astro");

// The exact regression: a sentence that NAMES the channels instead of listing what is live.
const NAMES_A_CHANNEL = /kanal\s*resmi\s*(?:[—–-]|&\s*mdash\s*;)\s*transfer\s*bank/i;

describe("SF-4 — the cart's payment trust line is DERIVED, never written", () => {
  const CODE = codeOnly(cartRaw);
  const MARKUP = textWithoutComments(cartRaw);

  // ⚠️ THE CLAIM IS THE DERIVATION CHAIN, NOT A FUNCTION NAME. The page used to call
  // `enabledPaymentChannels()` and keep its own `KIND_LABEL` map — a second copy of the one in
  // `index.astro`, differing only in capitalisation, i.e. the shape where the next edit changes one
  // and leaves the other making a different claim about which channels are live. The vocabulary now
  // lives once in `data/catalog.ts` as `paymentKindWords(style)`. So this asserts BOTH links: the
  // page derives from that helper, AND that helper derives from the live channel list. Pinning the
  // old name alone would have gone red on a refactor that made the guarantee stronger.
  it("reads the platform's live channel list, the same one checkout offers", () => {
    expect(CODE).toMatch(/import\s*\{[^}]*paymentKindWords/);
    expect(CODE).toMatch(/await\s+paymentKindWords\s*\(\s*"(?:title|sentence)"\s*\)/);
    const catalog = codeOnly(read("../data/catalog.ts"));
    expect(catalog).toMatch(/export\s+async\s+function\s+paymentKindWords/);
    expect(catalog).toMatch(/await\s+enabledPaymentChannels\s*\(\s*\)/);
  });

  it("renders the derived value, and falls back to a claim that holds with zero channels", () => {
    expect(MARKUP).toMatch(/\{\s*PAY_TRUST\s*\}/);
    // `payKinds.length ? … : …` — no live channel means no claim about channels.
    expect(CODE).toMatch(/payKinds\s*\.\s*length\s*\?/);
  });

  it("emits no hard-coded channel claim — the ewallet rows are enabled=f, active=f", () => {
    // Dash-tolerant: the shipped sentence used a literal em dash, but `&mdash;` lexes to
    // `& mdash ;` and would otherwise walk straight past this net.
    expect(MARKUP).not.toMatch(NAMES_A_CHANNEL);
  });

  it("would go red if the hard-coded sentence came back", () => {
    const regressed = cartRaw.replace(
      "<span>{PAY_TRUST}</span>",
      "<span>Pembayaran lewat kanal resmi \u2014 transfer bank &amp; QRIS.</span>",
    );
    expect(regressed, "the mutation no longer matches the source — update this self-check").not.toBe(cartRaw);
    expect(textWithoutComments(regressed)).toMatch(NAMES_A_CHANNEL);
  });

  it("would go red if the derivation were commented out", () => {
    const regressed = cartRaw.replace(
      'const payKinds = await paymentKindWords("sentence");',
      '// const payKinds = await paymentKindWords("sentence");',
    );
    expect(regressed, "the mutation no longer matches the source — update this self-check").not.toBe(cartRaw);
    expect(codeOnly(regressed)).not.toMatch(/await\s+paymentKindWords\s*\(/);
  });
});

describe("SF-4 — /thanks claims no presence and no guarantee nobody gave", () => {
  const MARKUP = textWithoutComments(thanksRaw);

  it("publishes no ADMIN ONLINE pill — nothing here knows whether a merchant is at their desk", () => {
    expect(MARKUP).not.toMatch(/ADMIN\s*ONLINE/i);
  });

  it("carries no English trust badge on an Indonesian page", () => {
    // "Safe Checkout · Quality Guaranteed": the only English on the page, and a guarantee no store
    // on this platform has agreed to. Every word a shopper reads is ours and is Bahasa Indonesia.
    expect(MARKUP).not.toMatch(/Safe\s*Checkout/i);
    expect(MARKUP).not.toMatch(/Quality\s*Guaranteed/i);
  });

  it("would go red if either came back", () => {
    const regressed = thanksRaw.replace(
      "</header>",
      '<span>ADMIN ONLINE</span></header>\n<p>Safe Checkout · Quality Guaranteed</p>',
    );
    expect(regressed).not.toBe(thanksRaw);
    const m = textWithoutComments(regressed);
    expect(m).toMatch(/ADMIN\s*ONLINE/i);
    expect(m).toMatch(/Safe\s*Checkout/i);
  });
});

describe("SF-6 — checkout ships no dead ORIGIN_CITY", () => {
  const CODE = codeOnly(checkoutRaw);

  it("the identifier is gone from the page and from its define:vars payload", () => {
    // It was `store.city || "Yogyakarta"`, injected into every checkout's inline script and read by
    // nothing. The server ignores `body.originCity` on purpose — an untrusted client string must
    // never decide a shipping price — so shipping a default origin to the browser was a dead leak
    // of one city's name into every store that has not set one.
    expect(CODE).not.toMatch(/ORIGIN_CITY/);
  });

  it("would go red if it came back", () => {
    const regressed = checkoutRaw.replace(
      "const STORE_SLUG = store.slug;",
      'const ORIGIN_CITY = store.city || "Yogyakarta";\nconst STORE_SLUG = store.slug;',
    );
    expect(regressed).not.toBe(checkoutRaw);
    expect(codeOnly(regressed)).toMatch(/ORIGIN_CITY/);
  });
});

describe("SF-7 — no storefront PAGE imports @tokophi/db", () => {
  // Derived from the DIRECTORY, not from a list of files: a list is how a new page reintroduces the
  // import unseen (`api/public` was invisible to two repo sweeps for exactly that reason). The API
  // endpoints under src/pages/api are the deliberate exception — endpoint-as-data-layer — and they
  // are `.ts`, so scanning only `.astro` names the exception structurally rather than by skipping a
  // directory by name.
  const pagesDir = fileURLToPath(new URL("../pages", import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".astro") ? [p] : [];
    });
  const pages = walk(pagesDir);

  // textWithoutComments, not codeOnly: the module specifier IS a string literal, whose contents
  // codeOnly makes inert — the claim could never match, in either direction. Comments are still
  // stripped, so the notes in checkout.astro naming this rule stay legal.
  const IMPORTS_DB = /from\s*["']@tokophi\s*\/\s*db["']/;

  it("finds the pages to scan at all", () => {
    expect(pages.length).toBeGreaterThan(15);
  });

  it("every .astro page reads through src/data/*, never the database directly", () => {
    const offenders = pages.filter((p) => IMPORTS_DB.test(textWithoutComments(readFileSync(p, "utf8"))));
    expect(offenders.map((p) => p.slice(pagesDir.length + 1))).toEqual([]);
  });

  it("would go red if checkout.astro took its recovery read back", () => {
    const regressed = checkoutRaw.replace(
      'import { getRecoveredCheckout } from "../data/checkout";',
      'import { db, schema } from "@tokophi/db";',
    );
    expect(regressed, "the mutation no longer matches the source — update this self-check").not.toBe(checkoutRaw);
    expect(IMPORTS_DB.test(textWithoutComments(regressed))).toBe(true);
  });
});
