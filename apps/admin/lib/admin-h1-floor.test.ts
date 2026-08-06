import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOURCE_SCAN_TIMEOUT_MS, textOfFile } from "../../../test/source-code";

// EVERY Seller route ships a top-level heading.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────────
//
// Measured in a browser on 2026-08-05, logged in as a real store owner: `/tema/[id]` had **no `<h1>`
// at all**. It is a FULL_BLEED route (`components/admin/admin-chrome.tsx`), so the sidebar and topbar
// are gone as well, and every heading Puck renders starts at `<h2>` — "Tema Toko — …", "Components",
// "Outline", "Page". A screen-reader user landing on the store builder had nothing to orient on, on
// the one screen that IS the page. `next build`, `tsc` and ESLint were all green over it, because
// nothing here has an opinion about heading levels.
//
// The storefront learned this three times already (the hero carousel's three `<h1>`s, a merchant-built
// homepage with none, and `/checkout` with none) and it is guarded there. The admin was not.
//
// ── WHY IT IS A NEW FILE AND NOT AN EXTENSION OF THE TWO STOREFRONT GUARDS ────────────────────────
//
// Both were read first, and neither can carry this claim:
//
//  · `apps/storefront/scripts/check-h1-floor.mjs` is an HTTP check driven by
//    `npm run verify -w @tokophi/storefront`. It resolves tenants from the `Host` header and needs no
//    session. The admin needs a *different server*, a login and a store — putting that inside the
//    storefront's verify script makes one surface's check depend on another surface booting.
//  · `apps/storefront/src/components/sections/h1-floor.test.ts` asserts about the storefront's
//    `.astro` SECTION components and `index.astro`. The admin's claim is about a Next route → client
//    component graph. Same rule, different subject; merging them would put admin assertions in
//    `apps/storefront/src/components/sections/`.
//
// What IS shared — and is the half that keeps getting hand-rolled wrong — is `test/source-code.ts`.
// No comment stripper is written here.
//
// ── WHICH HELPER, PER ASSERTION ──────────────────────────────────────────────────────────────────
//
// `textWithoutComments` for BOTH, and each for its own reason:
//
//  · The `<h1>` / `<PageHeader>` sweep is a claim about MARKUP THE FILE EMITS — the same choice
//    `h1-floor.test.ts` makes and for the same reason (markup concatenated into a string and handed
//    to `innerHTML` is emitted markup; `codeOnly` would inert it into invisibility).
//  · The IMPORT sweep needs the module specifier, and a specifier lives INSIDE a string literal —
//    `codeOnly` rewrites every character outside `[A-Za-z0-9_.@/-]` to `·`, which mangles exactly the
//    paths this repo uses (`../[id]/article-editor` becomes `..·[·id·]·…`) and the graph collapses.
//    Same reasoning as `no-published-credentials.test.ts`: when the evidence is the literal, inerting
//    the literal destroys the evidence.
//    The honest cost: a `from "…"` written inside some other string would be walked as if imported.
//    That can only ever ADD files to the graph, so state it and move on — and comments, the shape
//    that actually bit this repo nine times, are gone either way.
//
// PROVED RED, not taken on faith (2026-08-05): with the `<h1 className="sr-only">` removed from
// `app/(admin)/tema/[id]/builder-client.tsx`, this suite fails naming `/tema/[id]`; restored, it
// passes. A guard that has never been red is a guard that has never been tested.

const ADMIN = fileURLToPath(new URL("..", import.meta.url));
const ROUTE_ROOT = join(ADMIN, "app/(admin)");

/** Anything that puts a top-level heading on screen: a literal `<h1>` or the shared `PageHeader`. */
const EMITS_H1 = /<\s*(h1|PageHeader)[\s>/]/;

// 🔴 THE ONE EXCEPTION, AND THE MUTATION PROOF IS THE ONLY REASON IT IS HERE.
//
// The first version of this guard was GREEN over a `/tema/[id]` with its `<h1>` deleted. Not because
// of a comment — because the import graph is an OVER-approximation and it leaked: `builder-client`
// → `lib/theme/puck-config.tsx` → `components/theme/sections/Hero.tsx`, which emits an `<h1>`.
// That heading is real, but it belongs to the STOREFRONT page a merchant is composing and renders
// inside Puck's preview canvas — it is not the admin screen's heading, and `puck-config.tsx` already
// says so in its own comments ("a Hero (with its own `<h1>`) on a product page that already has the
// product name as its `<h1>`").
//
// So the section registry is excluded BY NAME, and named here rather than skipped by a vague rule —
// `apps/admin/app/api/public` is in CLAUDE.md as what happens when a sweep skips a directory by a
// name it did not think about. Everything else in the tree is walked.
//
// This is also the answer to "why bother mutating, the test was green": a guard that has only ever
// been green cannot tell you which of those two things it is.
const PREVIEW_ONLY = join(ADMIN, "components/theme/sections/");

const readable = (p: string) => existsSync(p) && !p.endsWith("/");

/** `./x` / `../x` / `@/x` → the file on disk, or null for a package specifier. */
function resolveLocal(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ADMIN, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // node_modules / workspace package — nothing in there renders an admin heading
  for (const cand of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (readable(cand) && /\.tsx?$/.test(cand)) return cand;
  }
  return null;
}

function localImports(text: string, from: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/from\s+"([^"]+)"/g)) {
    const hit = resolveLocal(m[1], from);
    if (hit) out.push(hit);
  }
  return out;
}

/** Every `page.tsx` under the `(admin)` route group. */
function routePages(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) routePages(p, acc);
    else if (e.name === "page.tsx") acc.push(p);
  }
  return acc;
}

/** `layout.tsx` from the route group down to (and including) the page's own directory. */
function ancestorLayouts(page: string): string[] {
  const out: string[] = [];
  for (let d = dirname(page); d.startsWith(ROUTE_ROOT); d = dirname(d)) {
    const l = join(d, "layout.tsx");
    if (existsSync(l)) out.push(l);
  }
  return out;
}

// ⏱ Does anything reachable from these roots emit a top-level heading?
//
// `textOfFile` memoises the lex per path (`test/source-code.ts`). That is what makes this affordable:
// there is one assertion PER ROUTE — 60 of them — over import graphs that overlap almost completely
// (every route reaches the same chrome, the same `components/ui`), so lexing per traversal meant the
// same files were re-lexed dozens of times. Measured: the file cost **14,1 s** of the suite that way
// and **1,1 s** with the memo. It was never near the 5 s ceiling because the cost was spread across
// 60 separate tests — which is exactly why nobody noticed it was the most expensive file in the run.
function reachesH1(roots: string[]): boolean {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f) || f.startsWith(PREVIEW_ONLY)) continue;
    seen.add(f);
    const text = textOfFile(f);
    if (EMITS_H1.test(text)) return true;
    queue.push(...localImports(text, f));
  }
  return false;
}

const pages = routePages(ROUTE_ROOT);
const routeOf = (p: string) => "/" + relative(ROUTE_ROOT, dirname(p)).replace(/\\/g, "/");

describe("every Seller route has an <h1>", () => {
  // A walker that finds nothing passes every assertion below. This is the whole reason
  // `inventory-location.test.ts` insists a sweep must prove it swept something.
  it("finds the admin routes at all", () => {
    expect(pages.length).toBeGreaterThan(40);
  });

  // The ceiling is here rather than on one test because WHICH route runs first is the runner's
  // choice, and that one pays for the whole graph. See `SOURCE_SCAN_TIMEOUT_MS`.
  it.each(pages.map((p) => [routeOf(p), p] as const))(
    "%s",
    (_route, page) => {
      expect(reachesH1([page, ...ancestorLayouts(page)])).toBe(true);
    },
    SOURCE_SCAN_TIMEOUT_MS,
  );
});
