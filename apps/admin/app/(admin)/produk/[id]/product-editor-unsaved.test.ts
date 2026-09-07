import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../../../../test/source-code";

/**
 * The product editor's unsaved-changes guard — Task 5.6 / F-C9.
 *
 * Three claims about `product-editor.tsx`, read as CODE (`codeOnly`) so a commented-out guard or
 * a string that spells one cannot keep this green:
 *
 *   1. `dirty` is DERIVED (`currentSnapshot !== savedSnapshot`), and a `beforeunload` listener is
 *      registered inside an effect keyed on it — the native tab-close prompt, no custom dialog.
 *   2. EVERY link back to `/produk` on the screen carries the `confirmLeave` handler. The list is
 *      counted, not named: a fourth link added without the handler fails here.
 *   3. Both accepted-save paths (`updateProduct`, `createProduct`) re-take the snapshot BEFORE the
 *      `router.push` that follows, and the `catch` path does not — a failed save keeps the guard.
 *
 * Each claim is proved to fire against a mutated COPY of the real file, because a predicate that
 * matches nothing is indistinguishable from one that matches everything (`uuid-guard.test.ts` has
 * the same self-check, for the same reason).
 */

const FILE = fileURLToPath(new URL("./product-editor.tsx", import.meta.url));
const real = readFileSync(FILE, "utf8");

function check(src: string) {
  const code = codeOnly(src);

  // 1. derived dirty + native beforeunload, registered while dirty
  expect(code).toMatch(/const\s+dirty\s*=\s*currentSnapshot\s*!==\s*savedSnapshot/);
  expect(code).toMatch(/if\s*\(\s*!\s*dirty\s*\)\s*return\s*;[\s\S]*?window\s*\.\s*addEventListener\s*\(\s*"beforeunload"/);
  expect(code).toMatch(/window\s*\.\s*removeEventListener\s*\(\s*"beforeunload"/);

  // 2. every /produk link is guarded
  const links = [...code.matchAll(/<\s*Link\s+href\s*=\s*"\/produk"([^>]*)>/g)];
  expect(links.length, "no /produk links found — the claim would be vacuous").toBeGreaterThan(0);
  for (const [tag, attrs] of links) {
    expect(attrs, `unguarded link: ${tag}`).toMatch(/onClick\s*=\s*\{\s*confirmLeave\s*\}/);
  }

  // 3. accepted save re-takes the snapshot before pushing; the failed path does not
  for (const action of ["updateProduct", "createProduct"]) {
    expect(code).toMatch(
      // The reset is the NEXT statement after the await — a looser window matched the OTHER branch's
      // reset when this one was removed (measured while writing this test).
      new RegExp(`await\\s+${action}\\s*\\([^)]*\\)\\s*;\\s*setSavedSnapshot\\s*\\(\\s*snapshot\\s*\\)\\s*;[\\s\\S]{0,200}?router\\s*\\.\\s*push`),
    );
  }
  const catchArm = code.slice(code.indexOf("await updateProduct")).match(/catch\s*\{[\s\S]*?\}/);
  expect(catchArm, "save catch arm not found").not.toBeNull();
  expect(catchArm![0]).not.toMatch(/setSavedSnapshot/);
}

describe("product editor unsaved-changes guard", () => {
  it("is derived, native on tab close, on every back link, and cleared only by an accepted save", () => {
    check(real);
  });

  it("the predicates fire against a copy with each half removed", () => {
    expect(real).toContain('window.addEventListener("beforeunload", warn);');
    expect(() => check(real.replace('window.addEventListener("beforeunload", warn);', ""))).toThrow();

    expect(real).toContain("const dirty = currentSnapshot !== savedSnapshot;");
    expect(() => check(real.replace("const dirty = currentSnapshot !== savedSnapshot;", "const dirty = true;"))).toThrow();

    expect(real).toContain('render={<Link href="/produk" onClick={confirmLeave} />}');
    expect(() => check(real.replace('render={<Link href="/produk" onClick={confirmLeave} />}', 'render={<Link href="/produk" />}'))).toThrow(
      /unguarded link/,
    );

    const reset = "await updateProduct(product.id, input);\n          setSavedSnapshot(snapshot);";
    expect(real).toContain(reset);
    expect(() => check(real.replace(reset, "await updateProduct(product.id, input);"))).toThrow();

    const failed = 'toast.error("Gagal menyimpan produk");';
    expect(real).toContain(failed);
    expect(() => check(real.replace(failed, `setSavedSnapshot(snapshot);\n        ${failed}`))).toThrow();
  });
});
