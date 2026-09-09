import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../../test/source-code";

// Page-map AD-6: `searchTaxonomy` was the ONE `"use server"` read with no session check. It reads
// global reference data (no store_id, no RLS), so the hole was small — but a rule with an exception
// is a rule the next reader has to remember, and the exception was exactly where a bare `db` call
// sat. Pinned as a source claim: the bail must come BEFORE the first `db.select`, and it must be
// `getSession`, not a capability (a search box has no capability to require).
const src = codeOnly(readFileSync(new URL("./taxonomy.ts", import.meta.url), "utf8"));

describe("searchTaxonomy bails on a missing session", () => {
  it("checks getSession() before touching db", () => {
    const bail = src.indexOf(codeOnly("if (!(await getSession())) return [];"));
    const query = src.indexOf(codeOnly("db . select("));
    expect(bail).toBeGreaterThan(-1);
    expect(query).toBeGreaterThan(-1);
    expect(bail).toBeLessThan(query);
  });
});
