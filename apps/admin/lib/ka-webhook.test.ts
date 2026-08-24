import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// KiriminAja webhook receiver — the push half of tracking (KA-UAT 2026-08-24).
// The load-bearing claims:
//   ① fail-closed bearer auth (no key configured ⇒ 401; wrong key ⇒ 401),
//   ② the route is HINT-ONLY — it never writes the database itself; every fact comes from
//      verifyKaHint's verified pull (kaTrack → syncOrderFromKa),
//   ③ the body goes through readPublicBody (the public-API rule; also pinned by
//      public-guard.test.ts's ROUTES list, which this route was added to).
const ROUTE = join(__dirname, "..", "app", "api", "public", "kiriminaja", "webhook", "route.ts");
const src = () => readFileSync(ROUTE, "utf8");

describe("ka-webhook route — auth is fail-closed", () => {
  beforeEach(() => {
    process.env.KIRIMINAJA_API_KEY = "test-ka-key-123";
  });

  const post = (auth?: string, body = JSON.stringify({ method: "processed_packages", data: [] })) =>
    new Request("http://x/api/public/kiriminaja/webhook", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    });

  it("refuses a missing bearer", async () => {
    const { POST } = await import("../app/api/public/kiriminaja/webhook/route");
    const res = await POST(post() as never);
    expect(res.status).toBe(401);
  });

  it("refuses a wrong bearer", async () => {
    const { POST } = await import("../app/api/public/kiriminaja/webhook/route");
    const res = await POST(post("Bearer wrong-key") as never);
    expect(res.status).toBe(401);
  });

  it("refuses EVERYTHING when no key is configured (fail closed, like cron-auth)", async () => {
    process.env.KIRIMINAJA_API_KEY = "";
    const { POST } = await import("../app/api/public/kiriminaja/webhook/route");
    const res = await POST(post("Bearer anything") as never);
    expect(res.status).toBe(401);
  });

  it("accepts the right bearer and answers 200 over an empty hint list", async () => {
    const { POST } = await import("../app/api/public/kiriminaja/webhook/route");
    const res = await POST(post("Bearer test-ka-key-123") as never);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; known: number };
    expect(j.ok).toBe(true);
    expect(j.known).toBe(0);
  });

  it("400s a non-JSON body instead of throwing", async () => {
    const { POST } = await import("../app/api/public/kiriminaja/webhook/route");
    const res = await POST(post("Bearer test-ka-key-123", "{not json") as never);
    expect(res.status).toBe(400);
  });
});

describe("ka-webhook route — hint-only, by source", () => {
  it("the route itself never writes the DB (no update/insert/execute) and never imports schema", () => {
    const code = codeOnly(src());
    // Mutation self-check: the predicate must FIRE on a copy that writes — otherwise this test is
    // green for want of matching anything (the public-guard rule).
    const writes = (c: string) => /\.\s*update\s*\(|\.\s*insert\s*\(|\.\s*execute\s*\(/.test(c);
    expect(writes(codeOnly('db.update(schema.orders).set({awb})'))).toBe(true);
    expect(writes(code), "webhook route must stay hint-only — writes belong to verifyKaHint's verified pull").toBe(false);
    expect(/from\s*"@tokophi\/db"/.test(code)).toBe(false);
  });

  it("auth is timing-safe and the body goes through readPublicBody", () => {
    const code = codeOnly(src());
    expect(/timingSafeEqual\s*\(/.test(code)).toBe(true);
    expect(/readPublicBody\s*\(/.test(code)).toBe(true);
    expect(/req\s*\.\s*json\s*\(/.test(code), "req.json() has no size ceiling — readPublicBody only").toBe(false);
  });
});
