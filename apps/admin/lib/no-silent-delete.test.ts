import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnly, textWithoutComments } from "../../../test/source-code";

// TASKS.md Epic 1 — "no silent destructive clicks". Six list screens deleted (or archived) a row
// straight from a `DropdownMenuItem onClick={del}`: one mis-tap on a phone and the row was gone, with
// the toast as the only record. Each now opens `ConfirmDelete` (components/admin/confirm-delete.tsx)
// and the action runs from its `onConfirm` — never from an `onClick` anywhere in the file.
//
// This is a SOURCE test because the defect is the absence of a step between the click and the
// server action: there is nothing to import and call, and `tsc` has no opinion. It reads the file's
// CODE through `codeOnly`, so a comment quoting the old `onClick={del}` cannot fail it and a string
// cannot satisfy it (CLAUDE.md, "A guard reads a file's CODE, never its TEXT").

const APP = join(__dirname, "..", "app", "(admin)");

// screen → [client file, the server action(s) that destroy the row]. `deleteProduct` /
// `bulkDeleteProducts` ARCHIVE (products are referenced by order_line_items) — same rule, same gate.
const LISTS: Record<string, { file: string; actions: string[] }> = {
  halaman: { file: "halaman/halaman-client.tsx", actions: ["deletePage"] },
  blog: { file: "blog/blog-client.tsx", actions: ["deleteArticle"] },
  diskon: { file: "diskon/diskon-client.tsx", actions: ["deleteDiscount"] },
  kategori: { file: "produk/kategori/kategori-client.tsx", actions: ["deleteCollection"] },
  "flash-sale": { file: "flash-sale/flash-sale-client.tsx", actions: ["deleteFlashSale"] },
  produk: { file: "produk/produk-client.tsx", actions: ["deleteProduct", "bulkDeleteProducts"] },
  // Second sweep (2026-09-08): lists that were still bare, plus the two EDITORS with a Hapus button —
  // a page-level delete is the same one-tap loss as a row menu's.
  pelanggan: { file: "pelanggan/pelanggan-client.tsx", actions: ["deleteCustomer"] },
  segmen: { file: "pelanggan/segmen/segmen-client.tsx", actions: ["deleteSegment"] },
  ulasan: { file: "pelanggan/ulasan/ulasan-client.tsx", actions: ["deleteReview"] },
  "crm-pipeline": { file: "crm/pipeline/pipeline-client.tsx", actions: ["deleteLead"] },
  "crm-template": { file: "crm/template/template-client.tsx", actions: ["deleteWaTemplate"] },
  tema: { file: "tema/tema-client.tsx", actions: ["deleteTemplate"] },
  "flash-sale-editor": { file: "flash-sale/[id]/flash-editor.tsx", actions: ["deleteFlashSale"] },
  "landing-editor": { file: "promo/html/[id]/landing-editor-client.tsx", actions: ["deleteLanding"] },
};

const src = (file: string) => readFileSync(join(APP, file), "utf8");

/** Every `<attr>={ … }` JSX expression in the lexed code, braces balanced. */
function jsxAttrBodies(code: string, attr: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${attr}\\s*=\\s*\\{`, "g");
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") depth--;
    }
    out.push(code.slice(start, i - 1));
  }
  return out;
}

/**
 * The local handlers that reach a destructive action: `const del = ( ) => start ( async ( ) => { …
 * const res = await deletePage ( … } )`. For each action call, the nearest preceding ZERO-ARG arrow
 * `const` is the handler. Not "the `const` whose initializer contains the call": `res` and `r` are
 * themselves `const`s inside the handler body, and a forward fence stopped at them.
 */
function handlersReaching(code: string, actions: string[]): string[] {
  const starts: { name: string; at: number }[] = [];
  const decl = /\bconst (\w+) = (?:async )?\( \) =>/g;
  for (let m = decl.exec(code); m; m = decl.exec(code)) starts.push({ name: m[1], at: m.index });
  const names = new Set<string>();
  for (const a of actions) {
    const call = new RegExp(`\\b${a}\\s*\\(`, "g");
    for (let m = call.exec(code); m; m = call.exec(code)) {
      const owner = starts.filter((h) => h.at < m!.index).at(-1);
      if (owner) names.add(owner.name);
    }
  }
  return [...names];
}

/** The claim, as one predicate — so the mutation proofs below run exactly what the guard runs. */
function violations(source: string, actions: string[]): string[] {
  const code = codeOnly(source);
  const reaches = new RegExp(`\\b(${[...actions, ...handlersReaching(code, actions)].join("|")})\\b`);
  const errs: string[] = [];
  for (const body of jsxAttrBodies(code, "onClick")) {
    if (reaches.test(body)) errs.push(`onClick reaches the action: {${body.trim()}}`);
  }
  const confirmed = jsxAttrBodies(code, "onConfirm").filter((b) => reaches.test(b));
  if (!confirmed.length) errs.push("no onConfirm reaches the action");
  if (!/<\s*ConfirmDelete\b/.test(code)) errs.push("ConfirmDelete is not rendered");
  return errs;
}

describe("no list deletes without a confirm step", () => {
  for (const [screen, { file, actions }] of Object.entries(LISTS)) {
    it(`${screen}: ${actions.join(" + ")} is reached only through ConfirmDelete's onConfirm`, () => {
      const source = src(file);
      expect(violations(source, actions)).toEqual([]);
      // `handlersReaching` must have found the wrapper (del/archive/bulkArchive), or the onClick rule
      // above was only ever checking for the bare action name — a claim about half the shape.
      expect(handlersReaching(codeOnly(source), actions).length).toBeGreaterThan(0);
      // The import path is a string literal, which `codeOnly` makes inert — this one claim is about
      // WHICH module, so it reads the comment-stripped text (CLAUDE.md: choose per assertion).
      expect(textWithoutComments(source)).toMatch(
        /import \{ ConfirmDelete \} from "@\/components\/admin\/confirm-delete"/,
      );
    });
  }

  // Mutation proofs: the same predicate, on a mutated COPY of each file, must go red — otherwise the
  // green above could be for want of matching anything (a guard converted on faith has been green for
  // the wrong reason in this repo before).
  for (const [screen, { file, actions }] of Object.entries(LISTS)) {
    it(`${screen}: goes red when the confirm is bypassed`, () => {
      const source = src(file);
      // (a) the pre-fix shape: the menu item fires the handler directly.
      const direct = source.replace(/onClick=\{\(\) => set(?:Confirm|BulkArchive)Open\(true\)\}/, (m, i) => {
        const handler = handlersReaching(codeOnly(source), actions)[0];
        return i >= 0 ? `onClick={${handler}}` : m;
      });
      expect(direct).not.toBe(source);
      expect(violations(direct, actions)).not.toEqual([]);
      // (b) the confirm is rendered but wired to nothing destructive.
      const unwired = source.replace(/onConfirm=\{[^}]*\}/g, "onConfirm={() => undefined}");
      expect(unwired).not.toBe(source);
      expect(violations(unwired, actions)).toContain("no onConfirm reaches the action");
      // (c) a comment or a string quoting the old shape is NOT a violation — the guard reads code.
      const quoted = source + `\n// <DropdownMenuItem onClick={${actions[0]}} />\nconst _s = "onClick={${actions[0]}}";\n`;
      expect(violations(quoted, actions)).toEqual([]);
    });
  }
});
