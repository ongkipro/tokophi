import { describe, expect, it } from "vitest";
import { SOURCE_SCAN_TIMEOUT_MS, codeOfFile, codeOnly, isTestFile, trackedSources } from "../../../test/source-code";
import { NAME_MAX, RESERVED_SLUGS, STORE_NAME_MIN, isReservedSlug, slugify } from "./store-slug";

// ── ONE SLUGIFY. It is a store's permanent public address, and there were two ────────────────────

describe("slugify", () => {
  it("keeps a letter that carried a diacritic, instead of splitting the word on it", () => {
    // The measured drift, both directions. `caf-senja` is what super-admin's copy produced (no NFKD);
    // `toko-ibu-e-ni` is what apps/admin's produced (NFKD, marks NOT stripped, so the combining acute
    // became a separator). Neither is what anyone wanted, and a slug cannot be fixed after the fact.
    expect(slugify("Café Senja")).toBe("cafe-senja");
    expect(slugify("Toko Ibu Éni")).toBe("toko-ibu-eni");
    expect(slugify("Warung Ayu Ñoño")).toBe("warung-ayu-nono");
  });

  it("is unchanged for the ASCII names that were already right", () => {
    expect(slugify("Batik Nusantara")).toBe("batik-nusantara");
    expect(slugify("  Kopi   Senja  ")).toBe("kopi-senja");
    expect(slugify("Toko 24 Jam")).toBe("toko-24-jam");
  });

  it("returns empty for a name with nothing sluggable in it — the callers' fallback depends on it", () => {
    // `provisionStore` does `slugify(storeName) || slugify(email.split("@")[0]) || "toko"`, and
    // `createStore` refuses outright. Both branches need the empty string, not a lone "-".
    expect(slugify("的")).toBe("");
    expect(slugify("!!!")).toBe("");
    expect(slugify("---")).toBe("");
  });
});

describe("RESERVED_SLUGS", () => {
  it("holds exactly the hostnames the storefront refuses to resolve", () => {
    // `tema-platform` is not a hostname convention like the others: it is the platform default theme
    // holder's FIXED slug (platform-theme.ts) — reserved so a merchant can never take it before the
    // deploy seed inserts the holder row. See the note beside it in store-slug.ts.
    expect([...RESERVED_SLUGS].sort()).toEqual(
      [
        "admin",
        "api",
        "app",
        "batik-nusantara",
        "cname",
        "localhost",
        "rich",
        "storefront",
        "tema-platform",
        "toko",
        "www",
      ].sort(),
    );
  });

  it("catches the shop names that produced them", () => {
    // Not hypothetical spellings — these are the ones a real merchant types.
    for (const name of ["App", "RICH", "Admin", "Toko", "WWW"]) {
      expect(isReservedSlug(slugify(name))).toBe(true);
    }
    // `batik-nusantara` was freed by the 2026-08-12 rename and would be minted again by exactly this
    // name — but the storefront middleware 301s `batik-nusantara.<base>` to the DEMO store before it
    // even resolves a tenant, so a merchant allocated this slug would get a storefront that
    // permanently serves somebody else's shop. Same class as the `slug: "app"` store, worse outcome
    // (another tenant's content, not a 404). Reserved for as long as that redirect exists.
    expect(isReservedSlug(slugify("Batik Nusantara"))).toBe(true);
    expect(isReservedSlug(slugify("Aplikasi Ibu"))).toBe(false);
  });

  it("includes `toko`, which is ALSO provisionStore's last-resort base", () => {
    // `slugify(name) || slugify(email-local) || "toko"` ends on a reserved word, so `uniqueSlug` has
    // to skip past it to `toko-2` rather than mint an unreachable store. If this ever stops being
    // true, the fallback silently becomes the bug this list exists to prevent.
    expect(isReservedSlug("toko")).toBe(true);
  });
});

// ── NO SECOND COPY OF EITHER — the sink, not a list of files ─────────────────────────────────────
//
// The whole point of this module is that a private copy is how the weaker half survives a fix (the
// password mint, the session cookie, and now this). So the guard is a repo sweep, not two paths.

const SELF = ["packages/lib/src/store-slug.ts", "packages/lib/src/store-slug.test.ts"];

// `trackedSources()` is the ONE lister (`test/source-code.ts`); the two exceptions below are this
// guard's own and are named here, next to the claim they narrow.
//
// ⚠️ TESTS ARE NOT PRODUCT WRITERS. `provision-conflicts.test.ts` inserts a store with a literal
// slug ON PURPOSE — it provokes the unique violation — and must NOT import the shared rule. This
// guard flagged it as a fourth writer, which is a false positive in the guard, not a defect in the
// test. Excluded by suffix rather than by name: the next such fixture would otherwise repeat it.
const repoSources = (): string[] => trackedSources().filter((rel) => !SELF.includes(rel) && !isTestFile(rel));

// ⚠️ THE CLAIM IS ABOUT THE **STORE** SLUG, AND THE SINK IS WHAT IDENTIFIES ONE.
//
// A name-based sweep ("no file defines `slugify`") is WRONG here and was tried first: it turned up
// seven more definitions in `collections.ts`, `catalog.ts`, `landing.ts`, three editors and the seed.
// Six of those mint a **handle** — a product, a collection, a landing page — which is scoped to one
// store, is not a hostname, and has no business consulting a list of reserved SUBDOMAINS. Converging
// them would be a change of behaviour dressed as a de-duplication.
//
// The seventh was real, and only the sink form finds it: `packages/db/src/seed.ts` writes
// `stores.slug` with a private non-NFKD copy. It agrees today because "Batik Nusantara" is ASCII —
// i.e. a THIRD store-slug rule, invisible to a reviewer and to every test, waiting for one accent.
//
// So: a file that writes `schema.stores` … `slug` must import the shared rule.
// ⚠️ The window is SHORT and stops at the first `)` group on purpose. It was `{0,400}` and that
// reached past the statement it was anchored on into an unrelated `schema.stores.slug` in a later
// `delete(...)` line — so whether it fired depended on how many characters sat between two unrelated
// statements. A guard whose verdict moves with whitespace is not a guard.
const WRITES_STORE_SLUG = /insert\s*\(\s*schema\s*\.\s*stores\s*\)\s*\.\s*values\s*\(\s*\{[^}]{0,200}?\bslug\b/;
const IMPORTS_SHARED = /from\s*"@tokophi\/lib\/store-slug"/;
const REDEFINES_RESERVED = /const\s+RESERVED(?:_SLUGS)?\s*=\s*new\s+Set\s*\(/;

describe("every writer of stores.slug uses the shared rule", () => {
  // `codeOfFile` memoises per path, so these three questions cost ONE lex of the repo between them
  // rather than three. Each still carries the ceiling: whichever runs first pays for all of them, and
  // which one that is depends on the runner.
  const storeSlugWriters = () => repoSources().filter((rel) => WRITES_STORE_SLUG.test(codeOfFile(rel)));

  // ⚠️ One writer is a NAMED exception to the import rule, not a hole in it: `seed-platform-theme.ts`
  // writes `slug: PLATFORM_THEME_SLUG` — a fixed constant, not a slug minted from a user's name — so
  // there is nothing for `slugify` to do there. The constant itself is pinned against this module
  // (slugify-identity + RESERVED) by `platform-theme.test.ts`, and the writer must import it from
  // `@tokophi/lib/platform-theme` rather than spell the string by hand.
  const CONSTANT_SLUG_WRITERS = new Set(["packages/db/src/seed-platform-theme.ts"]);
  const IMPORTS_PLATFORM_CONSTANT = /from\s*"@tokophi\/lib\/platform-theme"/;

  it("finds the four writers, and no more", () => {
    expect(storeSlugWriters().sort()).toEqual(
      [
        "apps/admin/lib/provision.ts",
        "apps/super-admin/lib/actions.ts",
        "packages/db/src/seed.ts",
        "packages/db/src/seed-platform-theme.ts",
      ].sort(),
    );
  }, SOURCE_SCAN_TIMEOUT_MS);

  it("and each one imports it (or, for the named constant writer, the pinned constant)", () => {
    for (const rel of storeSlugWriters()) {
      if (CONSTANT_SLUG_WRITERS.has(rel)) {
        expect(codeOfFile(rel), rel).toMatch(IMPORTS_PLATFORM_CONSTANT);
        // …and it must not ALSO be minting slugs from names — that would make the exception a hole.
        expect(codeOfFile(rel), rel).not.toMatch(/\bslugify\s*\(/);
        continue;
      }
      expect(codeOfFile(rel), rel).toMatch(IMPORTS_SHARED);
    }
  }, SOURCE_SCAN_TIMEOUT_MS);

  it("no second reserved-subdomain list", () => {
    const offenders = repoSources().filter((rel) => REDEFINES_RESERVED.test(codeOfFile(rel)));
    expect(offenders).toEqual([]);
  }, SOURCE_SCAN_TIMEOUT_MS);

  // Prove the patterns can fire — a sweep nobody has seen red is green for reasons nobody checked.
  it("catches each shape that actually shipped", () => {
    const seedShape = codeOnly(`await db.insert(schema.stores).values({ name: STORE.name, slug: slugify(STORE.name) });`);
    expect(WRITES_STORE_SLUG.test(seedShape)).toBe(true);
    expect(REDEFINES_RESERVED.test(codeOnly(`const RESERVED = new Set(["www", "app", "rich"]);`))).toBe(true);
    // …and that the storefront's converged line is not mistaken for a redefinition.
    expect(REDEFINES_RESERVED.test(codeOnly(`const RESERVED = RESERVED_SLUGS;`))).toBe(false);
    // …and that a per-store HANDLE writer is correctly out of scope.
    expect(WRITES_STORE_SLUG.test(codeOnly(`db.insert(schema.collections).values({ handle: slugify(i.name) })`))).toBe(false);
  });
});

describe("the name bounds", () => {
  it("are a floor and a ceiling, and the ceiling matches the storefront's own MAX_NAME", () => {
    expect(STORE_NAME_MIN).toBe(3);
    expect(NAME_MAX).toBe(60);
    expect(codeOfFile("apps/storefront/src/lib/chat.ts")).toMatch(new RegExp(`MAX_NAME\\s*=\\s*${NAME_MAX}\\b`));
  });
});
