import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../../test/source-code";
import { MAX_BODY_BYTES, MAX_CART_ITEMS, readPublicBody } from "./public-guard";

// ── THE FOUR PUBLIC ROUTES, AND THE TWO THINGS THAT WERE UNBOUNDED ──────────────────────────────
//
// `apps/admin/app/api/public/**` is the only unauthenticated write surface in this product, and it
// was invisible to two repo-wide guards until a `public`-directory skip was fixed (CLAUDE.md). Two
// measurements on 2026-08-05, against a local dev server, are what this file exists to keep true:
//
//   · `/api/public/order` with 10.000 `items[]` → **50.498 index scans, 63,8 s** in ONE request.
//     Four sequential DB round-trips per element, no array cap. It never reaches the courier API or
//     a write; it only spends the database.
//   · a **64 MB** JSON body was accepted, buffered and parsed in 0,8 s. `req.json()` has no ceiling
//     in a Route Handler.
//
// And one leak: `/api/public/order` answered a crafted `service` with
// `"kurir nosuchcourier tidak terdaftar di sistem kami"` — the courier aggregator, in the FIRST
// PERSON, on the merchant's own checkout — while the payment gateway's `ket` ("Unauthorized" on a
// bad key, measured live) went out as `payError`. ADR 0004 says the providers stay hidden from
// merchants and shoppers; a verbatim pass-through of a third party's unbounded text cannot promise
// that, whichever strings it happens to emit today.

const ROUTES = ["ongkir", "order", "promo", "pay/callback", "kiriminaja/webhook"] as const;
const routeSrc = (name: string) =>
  readFileSync(join(__dirname, "..", "app", "api", "public", name, "route.ts"), "utf8");

describe("readPublicBody — the byte ceiling on an unauthenticated body", () => {
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request("http://x/api/public/order", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...headers },
      // Node requires this when the body is a stream.
      ...(body instanceof ReadableStream ? ({ duplex: "half" } as { duplex: "half" }) : {}),
    });

  it("passes an ordinary cart straight through", async () => {
    const json = JSON.stringify({ storeSlug: "batiknusantara", items: [{ handle: "x", qty: 1 }] });
    const out = await readPublicBody(post(json), {});
    expect(out.res).toBeUndefined();
    expect(JSON.parse(out.text!)).toMatchObject({ storeSlug: "batiknusantara" });
  });

  it("refuses a body over the cap with 413 — the declared length is the fast path", async () => {
    const out = await readPublicBody(post("x".repeat(MAX_BODY_BYTES + 1)), {});
    expect(out.text).toBeUndefined();
    expect(out.res!.status).toBe(413);
  });

  // The half that matters: `Content-Length` is the SENDER's claim. A chunked upload omits it
  // entirely, so a guard that trusts the header alone is the same "buffer first, measure after" bug
  // wearing a check's clothes.
  it("refuses an oversized CHUNKED body that declares no length at all", async () => {
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent > MAX_BODY_BYTES * 4) return c.close();
        sent += chunk.byteLength;
        c.enqueue(chunk);
      },
    });
    const req = post(stream);
    expect(req.headers.get("content-length")).toBeNull();
    const out = await readPublicBody(req, {});
    expect(out.res!.status).toBe(413);
    // It stopped reading rather than draining the whole upload into a socket nobody reads.
    expect(sent).toBeLessThan(MAX_BODY_BYTES * 4);
  });

  it("carries the caller's CORS headers on the refusal — the storefront is a different origin", async () => {
    const out = await readPublicBody(post("x".repeat(MAX_BODY_BYTES + 1)), {
      "Access-Control-Allow-Origin": "*",
    });
    expect(out.res!.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("the caps stay generous", () => {
  // Over-validation is a bug in this repo: a cap that refuses a real cart is a lost sale nobody
  // hears about. `checkout-session.ts` — which merely RECORDS a cart — caps at 50, so the endpoint
  // that takes the money must never be tighter than that.
  it("MAX_CART_ITEMS is at least the checkout-session cap", () => {
    expect(MAX_CART_ITEMS).toBeGreaterThanOrEqual(50);
  });

  // 100 lines of JSON is ~12 KB. Anything under ~64 KB would start refusing carts the item cap
  // still allows — two caps that disagree are one cap and one trap.
  it("MAX_BODY_BYTES leaves real headroom over a full-length cart", () => {
    expect(MAX_BODY_BYTES).toBeGreaterThanOrEqual(64 * 1024);
  });
});

describe("every public route reads its body through the cap", () => {
  it.each(ROUTES)("%s goes through readPublicBody and never bare req.json()", (name) => {
    const code = codeOnly(routeSrc(name));
    expect(code).toMatch(/readPublicBody\s*\(/);
    expect(code).not.toMatch(/req\s*\.\s*json\s*\(/);
  });

  // Prove the assertion can FAIL. A source guard that was never seen red is green for reasons
  // nobody has checked — this repo has been bitten by exactly that (CLAUDE.md, `test/source-code.ts`).
  it("goes red on a route that reverts to req.json()", () => {
    const reverted = codeOnly(routeSrc("promo").replace("readPublicBody(req, CORS)", "req.json()"));
    expect(reverted).toMatch(/req\s*\.\s*json\s*\(/);
  });
});

// ── ADR 0004: the provider's brand — and its VOICE — never reach a shopper ───────────────────────
//
// Our OWN messages still go out verbatim ("Tujuan belum dipilih.", "Alamat pengambilan toko belum
// diatur."): those are ours to say and the ones anyone can act on. What must not is the aggregator's
// `text` and the gateway's `ket`, which are unbounded strings written by someone else.
describe("no public route serves a provider's own error text", () => {
  const leaks = (src: string) => {
    const code = codeOnly(src);
    return (
      /payError\s*:\s*pay\s*\.\s*error/.test(code) || // gateway `ket`, straight to the browser
      /bad\s*\(\s*quote\s*\.\s*error/.test(code) || //  aggregator `text`, order route
      /error\s*:\s*q\s*\.\s*error/.test(code) //        aggregator `text`, ongkir route
    );
  };

  it("order/route.ts", () => expect(leaks(routeSrc("order"))).toBe(false));
  it("ongkir/route.ts", () => expect(leaks(routeSrc("ongkir"))).toBe(false));

  // Same self-proof: put each shipped bug back and the predicate must catch it.
  it("catches the two shapes that actually shipped", () => {
    expect(leaks(routeSrc("order").replace("payError: PAY_START_FAILED", "payError: pay.error"))).toBe(true);
    expect(
      leaks(
        routeSrc("order").replace(
          "return bad(quote.fromProvider ? SHIPPING_QUOTE_UNAVAILABLE : quote.error, \"shipping\");",
          'return bad(quote.error, "shipping");',
        ),
      ),
    ).toBe(true);
    expect(
      leaks(
        routeSrc("ongkir").replace(
          "{ ok: false, error: q.fromProvider ? SHIPPING_QUOTE_UNAVAILABLE : q.error },",
          "{ ok: false, error: q.error },",
        ),
      ),
    ).toBe(true);
  });
});
