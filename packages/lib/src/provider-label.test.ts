import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PAYMENT_SERVICE, SHIPPING_SERVICE } from "./provider-label";
import { textWithoutComments } from "../../../test/source-code";

// 🔴 ADR 0004: A PROVIDER BRAND NEVER REACHES A MERCHANT OR A SHOPPER.
//
// The decision is five months old and the payment side has always obeyed it. The shipping side
// leaked "KiriminAja" into NINE strings a seller can read — the Pengaturan → Pengiriman loading
// line, an order-detail hint, six server-action errors, and one sentence the tracking cron writes
// to `orders.problem_note`, which `ka-tracking.ts` itself documents as "merchant-facing". A rule
// re-obeyed by hand at every call site is how the ninth one happened (AGENTS.md says exactly this
// about `pct()`); this file makes it structural.
//
// HOW IT READS. `textWithoutComments`, not `codeOnly`: the leak lives INSIDE a string literal, so
// inerting literals would make this guard permanently green — the same reason
// `no-published-credentials.test.ts` keeps them. Comments are stripped (a comment may name the
// vendor; that is for us). Identifiers survive stripping, so the pattern is BOUNDARY-AWARE: a brand
// glued to identifier characters, an underscore, a path slash, `@` or `.` is code
// (`kiriminajaConfigured`, `KIRIMINAJA_API_KEY`, `@tokophi/lib/kiriminaja`, `schema.kiriminajaAreas`)
// and is not a sentence anyone reads.
//
// ⚠️ `apps/super-admin` is deliberately NOT scanned. Operators must see the real vendor — that is
// how a support call gets resolved. Adding it here would be a bug, not a tightening.

const BRAND = /(?<![A-Za-z0-9_/@.])(kirimin\s*aja|autolaris)(?![A-Za-z0-9_])/gi;
// SHIP-MENGANTAR (2026-11-05): the second shipping vendor. CASE-SENSITIVE on purpose, unlike the
// line above: lower-case "mengantar" is the Indonesian verb "to deliver", and real copy uses it
// ("Kurir mengantar ke …" on the success page, "Kurir tidak bisa mengantar tanpa alamat" in a
// shipping action). The brand is written capitalised or in caps; the verb mid-sentence is not.
const BRAND_MENGANTAR = /(?<![A-Za-z0-9_/@.])(Mengantar|MENGANTAR)(?![A-Za-z0-9_])/g;
// OWNER O5 (2026-11-05, Mengantar Partner Business API): every store now OWNS a Mengantar seller
// account (its email, its login, its wallet), so SELLER copy may name Mengantar. SHOPPERS still never
// see it: the Mengantar pattern keeps applying to the storefront, the landing site and the Seller app's
// shopper-facing public API (`apps/admin/app/api/public/**`). KiriminAja / AutoLaris stay hidden everywhere.
const SHOPPER_FACING = ["apps/storefront/", "apps/landing/", "apps/admin/app/api/public/"];
// KEL-001 (ADR 0021): Kelola CRM is a SELLER-CHOSEN plugin — Seller screens name it (like Meta), shoppers
// never see it. Only the unambiguous brand shapes are matched: bare "Kelola" is the everyday verb
// ("Kelola pesanan Anda") and would be a false positive on any landing headline.
const BRAND_KELOLA = /(?<![A-Za-z0-9_])(Kelola\s+CRM|kelolatim)(?![A-Za-z0-9_])/gi;

const CLIENT_SURFACES = ["apps/admin/", "apps/storefront/", "apps/landing/"];

// Every remaining prose-shaped match, NAMED, with the reason it is not client-visible. An entry
// must still match something — an allowance that matches nothing is a hole that reads like a rule.
const ALLOWED: { snippet: string; why: string }[] = [
  { snippet: 'provider : "autolaris"', why: "the stored value of payments.provider — a row the code reads back, never a label" },
  { snippet: '"[shipping] cannot build a KiriminAja order_id"', why: "console.error — a server log, not a screen" },
];

function clientFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(tsx?|astro)$/.test(f) && !f.includes(".test.") && CLIENT_SURFACES.some((d) => f.startsWith(d)));
}

function hits(text: string, file = "apps/storefront/x.ts"): { index: number; around: string }[] {
  const out: { index: number; around: string }[] = [];
  const patterns = SHOPPER_FACING.some((d) => file.startsWith(d)) ? [BRAND, BRAND_MENGANTAR, BRAND_KELOLA] : [BRAND];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      out.push({ index: m.index, around: text.slice(Math.max(0, m.index - 60), m.index + 50).replace(/\s+/g, " ") });
    }
  }
  return out;
}

describe("no provider brand in copy a merchant or shopper can read (ADR 0004)", () => {
  const files = clientFiles();
  const seenAllowance = new Set<string>();
  const leaks: string[] = [];

  for (const f of files) {
    const text = textWithoutComments(readFileSync(f, "utf8"));
    for (const h of hits(text, f)) {
      const allowed = ALLOWED.find((a) => h.around.includes(a.snippet));
      if (allowed) seenAllowance.add(allowed.snippet);
      else leaks.push(`${f}: …${h.around}…`);
    }
  }

  it("scans every client-facing source file, not a list", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith(".astro"))).toBe(true);
    expect(files.some((f) => f.includes("/super-admin/"))).toBe(false);
  });

  it("finds no brand in a sentence a client can read", () => {
    expect(leaks.join("\n")).toBe("");
  });

  it("every allowance still matches something — a stale one is a hole", () => {
    for (const a of ALLOWED) expect(seenAllowance.has(a.snippet), `${a.snippet} — ${a.why}`).toBe(true);
  });

  // MUTATION SELF-CHECK: the pattern must fire on the exact strings that shipped, or the claim above
  // is green for want of matching anything.
  it("would have caught each of the strings that leaked", () => {
    const shipped = [
      'Memuat layanan dari KiriminAja…',
      'jadi KiriminAja menolak booking tanpa',
      '"KiriminAja belum dikonfigurasi oleh platform."',
      '`Area tujuan "${o.city}" tidak ditemukan di KiriminAja.`',
      'KiriminAja menolak permintaan pelacakan secara permanen',
      '(daftarkan prefix order_id di KiriminAja Dashboard',
      'Pengiriman terdaftar di KiriminAja — belum ada pergerakan',
      // SHIP-MENGANTAR: the second provider answers to the same rule (risk R15).
      '"Mengantar belum dikonfigurasi oleh platform."',
      'Area tujuan tidak ditemukan di Mengantar.',
    ];
    for (const s of shipped) expect(hits(s).length, s).toBeGreaterThan(0);
  });

  it("O5: Seller copy may name Mengantar; the shopper-facing public API may not", () => {
    const s = "Toko ini belum terhubung ke akun Mengantar.";
    expect(hits(s, "apps/admin/lib/mengantar-shipping.ts").length).toBe(0);
    expect(hits(s, "apps/admin/app/api/public/order/route.ts").length).toBeGreaterThan(0);
    expect(hits(s, "apps/storefront/src/pages/checkout.astro").length).toBeGreaterThan(0);
    // KEL-001: the Kelola plugin is named on Seller screens, never to a shopper; the verb is never a hit.
    const k = "Pesanan dikirim ke Kelola CRM (https://kelolatim.com).";
    expect(hits(k, "apps/admin/components/admin/pengaturan/plugin-card.tsx").length).toBe(0);
    expect(hits(k, "apps/admin/app/api/public/order/route.ts").length).toBeGreaterThan(0);
    expect(hits(k, "apps/storefront/src/pages/checkout/sukses.astro").length).toBeGreaterThan(0);
    expect(hits("Kelola pesanan dan stok dari satu tempat.", "apps/landing/src/pages/index.astro").length).toBe(0);
    // KiriminAja stays hidden from the Seller too.
    expect(hits("Memuat layanan dari KiriminAja…", "apps/admin/lib/x.ts").length).toBeGreaterThan(0);
  });

  it("…and stays silent on code that merely names the vendor", () => {
    const code = [
      "kiriminajaConfigured()",
      "process.env.KIRIMINAJA_API_KEY",
      'from "@tokophi/lib/kiriminaja"',
      "schema.kiriminajaAreas.districtName",
      "autolarisConfigured()",
      "alCreatePayment(",
      'from "@tokophi/lib/mengantar"',
      "process.env.MENGANTAR_PARTNER_SECRET",
      "cfg.mengantar.partnerId",
      "MENGANTAR_WALLET_UNPAID",
      // …nor on the Indonesian verb the case-sensitive pattern exists to spare.
      "Kurir mengantar ke alamatmu.",
      "Kurir tidak bisa mengantar tanpa alamat lengkap",
    ];
    for (const s of code) expect(hits(s).length, s).toBe(0);
  });

  it("the replacement labels name the platform, never a provider", () => {
    for (const label of [SHIPPING_SERVICE, PAYMENT_SERVICE]) {
      expect(label).toMatch(/TokoΦ/);
      expect(hits(label).length).toBe(0);
    }
  });
});
