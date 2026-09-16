import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";
import { buildCompInvoice } from "./comp-invoice";

// Task 8.26 — a comp leaves a Rp0 `kind='comp'` invoice behind, and `compStore` writes it in the
// SAME transaction as the period move. The first half is the pure shape; the second is a source
// claim, because `actions.ts` is `"use server"` + `@tokophi/db` at module scope and cannot be driven.

describe("buildCompInvoice", () => {
  const at = new Date("2026-09-17T03:00:00Z");
  const row = buildCompInvoice({ storeId: "s1", accountId: "a1", months: 2, at });

  it("is Rp0, tax Rp0, already paid, kind+cycle comp, and stamped with the grant time", () => {
    expect(row).toMatchObject({ amountIdr: 0, taxIdr: 0, status: "dibayar", kind: "comp", cycle: "comp", periodMonths: 2, storeId: "s1", accountId: "a1" });
    expect(row.issuedAt).toBe(at);
    expect(row.paidAt).toBe(at);
  });

  it("mints a COMP- number, unique per call (invoices.number is globally unique)", () => {
    expect(row.number).toMatch(/^COMP-[0-9a-f]{12}$/);
    const other = buildCompInvoice({ storeId: "s1", accountId: "a1", months: 1, at });
    expect(other.number).not.toBe(row.number);
  });

  it("refuses a nonsensical grant length", () => {
    expect(() => buildCompInvoice({ storeId: "s1", accountId: "a1", months: 0, at })).toThrow();
    expect(() => buildCompInvoice({ storeId: "s1", accountId: "a1", months: 1.5, at })).toThrow();
  });
});

describe("compStore writes the comp invoice inside the period-move transaction", () => {
  const src = codeOnly(readFileSync(path.join(__dirname, "actions.ts"), "utf8"));
  const body = src.slice(src.indexOf("export async function compStore"), src.indexOf("export async function extendTrial"));

  it("inserts a buildCompInvoice row on the txn handle, beside the currentPeriodEnd update", () => {
    expect(body).toMatch(/db\s*\.\s*transaction\s*\(/);
    expect(body).toMatch(/tx\s*\.\s*update\s*\(\s*schema\s*\.\s*stores\s*\)\s*\.\s*set\s*\(\s*\{\s*currentPeriodEnd/);
    expect(body).toMatch(/tx\s*\.\s*insert\s*\(\s*schema\s*\.\s*invoices\s*\)\s*\.\s*values\s*\(\s*buildCompInvoice\s*\(/);
    // No write outside the transaction: the bare `db.update` shape that used to be here is gone.
    expect(body).not.toMatch(/\bdb\s*\.\s*update\s*\(\s*schema\s*\.\s*stores/);
  });
});
