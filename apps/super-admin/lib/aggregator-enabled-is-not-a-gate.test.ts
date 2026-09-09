import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// ⚪ `shipping_aggregator.enabled` IS A RECORD, NOT A SWITCH (Task 8.12, 2026-09-09 — the same ruling
// as `platform_payment_gateways.enabled`, owner, 2026-08-20).
//
// Nothing on any shipping path reads it. `shipping-quote.ts`, `api/public/ongkir` and
// `actions/shipping.ts` gate on `platform_couriers.enabled` ∩ `store_shipping_methods.enabled`
// (+ `platform_cod.enabled` for COD); the column's only readers were the seed and an "Aktif" badge on
// the super-admin Kurir card — which rendered green directly beside the red "Ditolak" of a real
// upstream 401 (found while driving Task 8.3). There was no Switch for it either: a status light
// wired to nothing.
//
// The column is kept rather than dropped (dropping is a destructive migration), the same standing as
// `platform_payment_gateways.enabled`. What is pinned here is that nobody rebuilds a status light on
// it: `getAggregator` no longer returns the field, and the screen renders nothing off it. If a
// platform-wide aggregator kill-switch is ever wanted, it must be ENFORCED at `shipping-quote.ts`
// first — the way `platform_cod.enabled` is — and only then surfaced; this test is what has to be
// rewritten then, deliberately.
//
// A source guard because the claim is about the ABSENCE of markup: there is nothing to import and
// call, and no type checker has an opinion about a badge that is gone. Read as CODE, so the long
// comment the screen now carries — which names `aggregator.enabled` in prose — cannot keep it green.

const SCREEN_PATH = new URL("../app/(platform)/pengaturan/pengaturan-client.tsx", import.meta.url);
const SCREEN = codeOnly(readFileSync(SCREEN_PATH, "utf8"));
const DATA = codeOnly(readFileSync(new URL("./data.ts", import.meta.url), "utf8"));

/** A JSX conditional rendering anything off the shipping aggregator's `enabled`/`on` flag. */
const rendersOffTheFlag = (code: string) =>
  /aggregator\s*\??\.\s*(enabled|on)\s*(&&|\?)/.test(code);

describe("no status light is built on shipping_aggregator.enabled", () => {
  it("the settings screen renders nothing off aggregator.enabled", () => {
    expect(rendersOffTheFlag(SCREEN)).toBe(false);
  });

  // Proves the predicate can fire. A source guard nobody has seen red is green for reasons nobody
  // has checked — this repo has made that mistake nine times over comment-vs-code alone.
  it("goes red if the badge is put back", () => {
    const anchor = "<KaProbeBadge probe={kaProbe} />";
    const src = readFileSync(SCREEN_PATH, "utf8");
    expect(src).toContain(anchor);
    const reverted = codeOnly(src.replace(anchor, `{aggregator.enabled && (<Badge>Aktif</Badge>)}${anchor}`));
    expect(rendersOffTheFlag(reverted)).toBe(true);
    // …and against the shape a rebuild would most likely take, `on` instead of `enabled`.
    expect(rendersOffTheFlag(codeOnly(`{aggregator?.on ? <Badge>Aktif</Badge> : null}`))).toBe(true);
  });

  // The read layer does not hand the screen the flag at all — the badge cannot come back by
  // accident from a field that is simply there.
  it("getAggregator does not return `enabled`", () => {
    const fn = DATA.slice(DATA.indexOf("export async function getAggregator"));
    const body = fn.slice(0, fn.indexOf("export async function", 1));
    expect(body).not.toMatch(/\benabled\b/);
  });

  // The Kurir card keeps the ENFORCED fact (how many couriers checkout will offer) and the MEASURED
  // one (the live probe, Task 8.3). Removing a false signal must not quietly remove a true one.
  it("the courier counter and the probe badge stay", () => {
    expect(SCREEN).toMatch(/couriers\s*\.\s*filter\s*\(\s*\(\s*c\s*\)\s*=>\s*c\s*\.\s*on\s*\)\s*\.\s*length/);
    expect(SCREEN).toMatch(/KaProbeBadge\s+probe\s*=\s*\{\s*kaProbe\s*\}/);
    expect(SCREEN).toMatch(/aggregator\s*\.\s*env/);
  });
});
