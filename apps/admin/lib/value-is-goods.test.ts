import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// Owner ruling 2026-08-24: conversion `value` = GOODS ONLY (no ongkir, no admin fee) on Meta, GA4
// AND TikTok. The all-in total stays on the row as the audit figure — so the exact regression this
// guard exists for is a "tidy-up" that points a platform's `value` back at `event.value`.
const capi = () => codeOnly(readFileSync(join(__dirname, "capi.ts"), "utf8"));
const pixels = () =>
  codeOnly(readFileSync(join(__dirname, "..", "..", "storefront", "src", "components", "MarketingPixels.astro"), "utf8"));

describe("conversion value = goods only (owner ruling 2026-08-24)", () => {
  // goods-first expression, whitespace-tolerant per the source-code module's contract
  const GOODS_FIRST = /typeof\s+event\s*\.\s*goods\s*===\s*"number"\s*&&\s*event\s*\.\s*goods\s*>\s*0\s*\?\s*event\s*\.\s*goods\s*:\s*event\s*\.\s*value/g;

  it("capi.ts maps value goods-first for ALL THREE platforms (Meta, GA4, TikTok)", () => {
    const hits = capi().match(GOODS_FIRST) ?? [];
    expect(hits.length, "expected 3 goods-first value mappings (meta, ga4, tiktok)").toBeGreaterThanOrEqual(3);
  });

  it("mutation self-check: a bare `value: event.value` platform mapping would NOT satisfy the pattern", () => {
    expect((codeOnly("custom_data = { value: event.value, currency: c }").match(GOODS_FIRST) ?? []).length).toBe(0);
  });

  it("the browser Purchase uses the goods-derived amount, never data.value directly", () => {
    const src = pixels();
    expect(/var\s+purchaseVal\s*=\s*goods\s*!==\s*null\s*\?\s*goods/.test(src)).toBe(true);
    // neither pixel's Purchase arm may reach for the all-in total again
    expect(/Purchase"\s*\)\s*\{\s*d\s*=\s*\{\s*value:\s*data\s*\.\s*value/.test(src)).toBe(false);
  });
});
