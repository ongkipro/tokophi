import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { textWithoutComments } from "../../../test/source-code";

// Every literal link in the Seller panel leads somewhere that RENDERS.
//
// ── WHY THIS EXISTS (N54) ─────────────────────────────────────────────────────────────────────────
//
// Measured in a browser on 2026-08-05, logged in as the store owner: `/promo` → "Buat baru" → **404**.
// `promo-list-client.tsx` linked to `/promo/html/baru`, and `promo/html/` held only `[id]`, whose page
// starts `if (!isUuid(id)) notFound()`. So the ONLY door into the custom-HTML landing feature — an
// editor, a storefront renderer at `/lp/<slug>`, an owner-only `landing:html` capability — was shut.
// Existing rows edited fine, which is why it survived: the screen looked complete.
//
// ── WHY THE OBVIOUS VERSION OF THIS GUARD IS BLIND ───────────────────────────────────────────────
//
// "Does a route file exist for this href" finds NOTHING here, and that was measured before this file
// was written: `promo/html/[id]` matches `/promo/html/baru` perfectly well at the routing layer. The
// 404 is produced at RUNTIME, by the `isUuid` guard inside the page — which is correct and must stay
// (Postgres throws `22P02` on a non-UUID: a 500 where a 404 belongs, `lib/uuid.ts`).
//
// So the claim has to be the one that was actually false: **a hard-coded path may not depend on a
// dynamic route that refuses it.** If no static route serves the href, and the dynamic route that
// catches it demands a UUID, then a literal segment like `baru` is a 404 with a link pointing at it.
// That is the class, not the instance — `diskon/[id]`, `flash-sale/[id]` and `promo/[id]` carry the
// same guard, so the next `/<thing>/baru` link written by hand fails here too.
//
// PROVED RED before the fix (2026-08-05): at `0b10aed`, with no `promo/html/baru/` route, this suite
// fails naming `/promo/html/baru` and the file that links to it. With the route added it passes, and
// deleting the route makes it red again. Nothing else in the admin violates it — 68 routes, 28
// distinct literal hrefs, one violation.
//
// ── WHICH HELPER ─────────────────────────────────────────────────────────────────────────────────
//
// `textWithoutComments`, both because the claim is about MARKUP the file emits (a JSX `href`
// attribute) and because the evidence IS the string literal: `codeOnly` inerts a literal's contents,
// so `href="/promo/html/baru"` would come back with the path scrubbed and the guard could never match
// a real link again. Comments must still go — a commented-out `href` links nowhere.
// The honest cost, same as `admin-h1-floor.test.ts`: a path written inside some unrelated string is
// checked as though it were a link. That can only ever ADD candidates, and every one of them is
// still a path this app is claiming exists.

const ADMIN = fileURLToPath(new URL("..", import.meta.url));
const APP = join(ADMIN, "app");

// Same expression as `lib/uuid.ts` — deliberately duplicated rather than imported, because this test
// asks "what does the ROUTE accept", and importing the implementation would make the guard agree with
// it by construction.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Route = { segs: string[]; file: string };

/** Every routable path under `app/`, with the file that serves it. Route GROUPS `(x)` add no segment. */
function routes(dir: string, segs: string[] = [], acc: Route[] = []): Route[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const page = entries.find((e) => e.isFile() && (e.name === "page.tsx" || e.name === "route.ts"));
  if (page) acc.push({ segs, file: join(dir, page.name) });
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith("_")) continue;
    const isGroup = e.name.startsWith("(") && e.name.endsWith(")");
    routes(join(dir, e.name), isGroup ? segs : [...segs, e.name], acc);
  }
  return acc;
}

function sources(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** null = this route does not serve the path; otherwise the dynamic segments it had to consume. */
function bind(route: Route, parts: string[]): { param: string; value: string }[] | null {
  const binds: { param: string; value: string }[] = [];
  let i = 0;
  for (const seg of route.segs) {
    if (seg.startsWith("[...") || seg.startsWith("[[...")) {
      binds.push({ param: seg, value: parts.slice(i).join("/") });
      return binds;
    }
    if (i >= parts.length) return null;
    if (seg.startsWith("[")) {
      binds.push({ param: seg, value: parts[i++] });
      continue;
    }
    if (seg !== parts[i++]) return null;
  }
  return i === parts.length ? binds : null;
}

const ROUTES = routes(APP);

/** `href="/…"` written as a literal. Template literals (`` href={`/promo/${id}`} ``) carry a real id. */
// Whitespace-tolerant because the scanner joins TOKENS with single spaces: `href="/promo"` reaches
// here as `href = "/promo"`. Written tightly first, this found **zero** links and the sweep's own
// "did I sweep anything" assertion is what caught it — which is the entire reason that assertion is
// above the real one.
const HREF = /href\s*=\s*"(\/[^"{}\s]*)"/g;

type Link = { href: string; from: string };
const links: Link[] = [];
for (const file of [...sources(APP), ...sources(join(ADMIN, "components"))]) {
  for (const m of textWithoutComments(readFileSync(file, "utf8")).matchAll(HREF)) {
    links.push({ href: m[1].split(/[?#]/)[0], from: relative(ADMIN, file) });
  }
}

/** "" or a sentence naming why this href does not render. */
function unreachable({ href }: Link): string {
  const parts = href.split("/").filter(Boolean);
  const hits = ROUTES.map((r) => ({ r, b: bind(r, parts) })).filter((x): x is { r: Route; b: NonNullable<ReturnType<typeof bind>> } => !!x.b);
  if (!hits.length) return "no route serves it";
  if (hits.some((x) => x.b.length === 0)) return ""; // a fully static route — nothing to argue with
  for (const { r, b } of hits) {
    // Only dynamic routes catch it. Does the one that does refuse a literal segment at runtime?
    if (!/isUuid\s*\(/.test(textWithoutComments(readFileSync(r.file, "utf8")))) continue;
    const bad = b.find((x) => !UUID.test(x.value));
    if (bad) return `only /${r.segs.join("/")} serves it, and that route 404s unless ${bad.param} is a UUID — "${bad.value}" is not`;
  }
  return "";
}

describe("every literal Seller link renders", () => {
  // A sweep that swept nothing passes every assertion under it.
  it("finds the routes and the links at all", () => {
    expect(ROUTES.length).toBeGreaterThan(40);
    expect(new Set(links.map((l) => l.href)).size).toBeGreaterThan(20);
  });

  it("no hard-coded path depends on a route that refuses it", () => {
    const broken = links.map((l) => ({ ...l, why: unreachable(l) })).filter((l) => l.why);
    expect(broken.map((l) => `${l.href} — ${l.why} (${l.from})`)).toEqual([]);
  });
});
