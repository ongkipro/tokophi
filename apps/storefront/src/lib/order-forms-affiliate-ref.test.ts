import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../../test/source-code";

// F-A13 (specs/AFFILIATE_SPEC.md): EVERY storefront form that submits an order sends the affiliate
// `?ref=` that MarketingPixels captured (localStorage `tphi:ref`), so `/api/public/order` attributes a
// landing-page sale exactly like a checkout sale. DERIVED, not listed — same discovery as
// `order-forms-post-kodepos.test.ts`, for the same reason: the landing funnel (`/promo/<handle>`,
// `/lp/<slug>`) is the form a by-name guard forgets, and it is where paid traffic converts. Until
// 2026-11-14 it sent no ref at all, so every affiliate sale made through a landing page was unpaid.
//
// The route side (a `refCode` alone ⇒ one `source='link'` commission, also in the funnel's own body
// shape) is proven against Postgres in `apps/admin/app/api/public/order/route.test.ts`.

const SRC = join(import.meta.dirname, "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(astro|ts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

const orderForms = sources(SRC)
  .map((file) => ({ file, raw: readFileSync(file, "utf8") }))
  .filter(({ raw }) => /ORDER_API|api\/public\/order/.test(raw) && /address\s*:\s*\{/.test(raw));

/** CODE, not text: the body sends `refCode`, and something in the file reads the captured `tphi:ref`. */
function sendsRef(raw: string): boolean {
  const code = codeOnly(raw);
  // A literal's other characters are made inert (`·`), so `"tphi:ref"` reads `"tphi·ref"` here.
  const readsCapture = /localStorage\s*\.\s*getItem\s*\(\s*"tphi.ref"/.test(code);
  const sendsKey = /refCode\s*:/.test(code);
  // The 30-day window, the same as checkout.astro and as the storefront promises on /affiliate.
  const window30 = /30\s*\*\s*86400000/.test(code);
  return readsCapture && sendsKey && window30;
}

describe("every storefront form that submits an order sends the captured affiliate ref (F-A13)", () => {
  it("finds both order forms (a guard that matches nothing is not a guard)", () => {
    const names = orderForms.map((f) => f.file.slice(SRC.length + 1));
    expect(names).toContain("components/OrderFunnel.astro");
    expect(names).toContain("pages/checkout.astro");
  });

  it.each(orderForms.map((f) => [f.file.slice(SRC.length + 1), f.raw] as const))("%s sends refCode from tphi:ref", (_name, raw) => {
    expect(sendsRef(raw)).toBe(true);
  });

  it("goes red on a funnel that stops sending it", () => {
    const funnel = orderForms.find((f) => f.file.endsWith("OrderFunnel.astro"))!;
    expect(sendsRef(funnel.raw.replace(/refCode:\s*refCode\(\),/, ""))).toBe(false);
    expect(sendsRef(funnel.raw.replace(/\/\/ F-A13[\s\S]*?function refCode\(\)/, "function refCode_off()").replace("tphi:ref", "tphi:other"))).toBe(false);
  });
});
