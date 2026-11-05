import { describe, expect, it, vi } from "vitest";
import { handleAffiliateApplication, type AffiliateApplyDeps } from "./affiliate-apply";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const GOOD = { name: "Sari Dewi", phone: "0812-3456-7890", email: "", channel: "IG @sari", bankName: "", bankAccount: "", bankHolder: "" };

/** A per-IP budget like the page's (5 per window), counted so a test can see who spent it. */
function deps(result: "created" | "exists" | "failed" = "created", budget = 5) {
  let used = 0;
  const allow = vi.fn(() => ++used <= budget);
  const apply = vi.fn<AffiliateApplyDeps["apply"]>(async () => result);
  return { allow, apply };
}

describe("handleAffiliateApplication — /affiliate POST (F-A2)", () => {
  it("honeypot filled: answers like a success, writes nothing, spends no rate budget", async () => {
    const d = deps();
    const r = await handleAffiliateApplication(form({ ...GOOD, website: "http://spam.example" }), d);
    expect(r).toMatchObject({ outcome: "ok", error: "" });
    expect(d.apply).not.toHaveBeenCalled();
    expect(d.allow).not.toHaveBeenCalled();
  });

  it("rate limit: the 6th submission from one network is refused before any write", async () => {
    const d = deps("created", 5);
    for (let i = 0; i < 5; i++) expect((await handleAffiliateApplication(form(GOOD), d)).outcome).toBe("ok");
    const sixth = await handleAffiliateApplication(form(GOOD), d);
    expect(sixth.outcome).toBe("form");
    expect(sixth.error).toMatch(/Terlalu banyak/);
    expect(d.apply).toHaveBeenCalledTimes(5);
  });

  it("a phone that already applied answers `exists`, not an error and not a second row", async () => {
    const d = deps("exists");
    const r = await handleAffiliateApplication(form(GOOD), d);
    expect(r).toMatchObject({ outcome: "exists", error: "" });
    expect(d.apply).toHaveBeenCalledTimes(1);
  });

  it("hands the write a canonical 62… phone and nulls for empty optionals", async () => {
    const d = deps();
    await handleAffiliateApplication(form(GOOD), d);
    expect(d.apply).toHaveBeenCalledWith({
      name: "Sari Dewi",
      phone: "6281234567890",
      email: null,
      channel: "IG @sari",
      bankName: null,
      bankAccount: null,
      bankHolder: null,
    });
  });

  it("missing name / invalid phone are refused before the write; values are echoed back clipped", async () => {
    const d = deps();
    expect((await handleAffiliateApplication(form({ ...GOOD, name: "  " }), d)).error).toBe("Nama wajib diisi.");
    const bad = await handleAffiliateApplication(form({ ...GOOD, phone: "12", name: "x".repeat(200) }), d);
    expect(bad.error).toBe("Nomor WhatsApp tidak valid.");
    expect(bad.values.name).toHaveLength(80);
    expect(d.apply).not.toHaveBeenCalled();
  });

  it("a failed write (no unique code) surfaces a retry message", async () => {
    const r = await handleAffiliateApplication(form(GOOD), deps("failed"));
    expect(r).toMatchObject({ outcome: "form", error: "Gagal menyimpan pendaftaran, coba lagi." });
  });
});
