import { describe, expect, it } from "vitest";
import { codeOnly, codeOfFile } from "../../../../../test/source-code";

// Task 5.18 follow-up — the Pesanan "Pengembalian" tab must not keep a caveat keyed on a courier
// that `lib/data/returns.ts` no longer emits. `rows.some((r) => r.courier === "Tidak diketahui")`
// went permanently false the moment the data layer stopped inventing that row, so courier-less
// orders were silently OMITTED instead of named. The count now arrives as `unattributed` and is
// rendered through the dashboard tile's own sentence (`unattributedNote`), so there is ONE copy.
//
// Read as CODE, not text (test/source-code.ts): a commented-out comparison must not count.

const FILE = "apps/admin/components/admin/pesanan/return-summary.tsx";
// codeOnly keeps a literal's WORDS and turns its whitespace into `·`.
const DEAD = /courier\s*===\s*"Tidak·diketahui"/;

describe("return-summary.tsx", () => {
  it("no longer compares a courier against the retired 'Tidak diketahui' placeholder", () => {
    expect(codeOfFile(FILE)).not.toMatch(DEAD);
  });
  it("(self-check) the pattern fires on the code it was written to catch", () => {
    expect(codeOnly(`rows.some((r) => r.courier === "Tidak diketahui")`)).toMatch(DEAD);
  });
  it("renders the unattributed count through the shared sentence", () => {
    const code = codeOfFile(FILE);
    expect(code).toMatch(/unattributedNote\s*\(\s*unattributed\s*\)/);
    expect(code).toMatch(/from\s*"@\/components\/admin\/dashboard\/return-by-courier"/);
  });
});
