import { describe, expect, it } from "vitest";
import { codeOnly, textWithoutComments } from "./source-code";

// Every case below is written as a PAIR: the raw text matches (which is why a text-matching guard is
// green over the broken tree) and `codeOnly` does not. The first half is the bug; the second is the
// fix. Deleting the first half would leave a test that passes for a reason nobody can check.

/** The shape `section-renderer-exhaustive.test.ts` mines for. */
const ARM = /case\s*"lookbook"\s*:\s*return\s*<\s*Lookbook/;

const smuggles: Array<[string, string]> = [
  ["a line comment", `// case "lookbook": return <Lookbook />\n`],
  ["a block comment", `/* case "lookbook": return <Lookbook /> */\n`],
  ["a JSX comment", `{/* case "lookbook": return <Lookbook /> */}\n`],
  // Single-quoted because the arm shape contains double quotes; both are one token kind to the
  // lexer (`StringLiteral`), so this covers the pair.
  ["a string literal", `const doc = 'case "lookbook": return <Lookbook />';\n`],
  ["a template literal", "const doc = `case \"lookbook\": return <Lookbook />`;\n"],
  // The `${}` is the one a naive lexer walk still lets through: the scanner hands back a plain `}`
  // and then lexes the REST OF THE TEMPLATE as code unless it is told to resume the template.
  ["a template with a substitution", "const doc = `${x}case \"lookbook\": return <Lookbook />`;\n"],
  ["a nested template", "const doc = `${`${y}`}case \"lookbook\": return <Lookbook />`;\n"],
  ["a regex literal", `const re = /case "lookbook": return <Lookbook \\/>/;\n`],
];

describe("codeOnly — a guard reads code, never text", () => {
  for (const [what, src] of smuggles) {
    it(`${what} is not code`, () => {
      expect(src, "the raw text DOES match — that is the whole defect").toMatch(ARM);
      expect(codeOnly(src)).not.toMatch(ARM);
    });
  }

  it("a real arm survives, spaced but intact", () => {
    // The other half of the claim. A guard that neutralises the smuggles by also losing the real
    // thing is not a guard, and this is exactly the assertion that catches an over-eager INERT set.
    expect(codeOnly(`switch (t) { case "lookbook": return <Lookbook {...p} />; }`)).toMatch(ARM);
  });

  it("keeps a literal's WORD, so a module specifier or an enum member is still assertable", () => {
    // `password.test.ts` matches `from "@tokophi/lib/password"`; the renderer matches `case "lookbook"`.
    // Inerting a literal down to nothing would break both, so `/`, `.`, `@`, `-` and `_` are kept.
    const code = codeOnly(`import { tempPassword } from "@tokophi/lib/password";`);
    expect(code).toMatch(/from\s*"@tokophi\/lib\/password"/);
    expect(codeOnly(`const t = "product-listing";`)).toMatch(/"product-listing"/);
  });

  it("does not eat code that merely LOOKS like a comment delimiter", () => {
    // The reason this is a lexer and not `src.replace(/\/\*[\s\S]*?\*\//g, "")`: that regex starts
    // eating at the `/*` inside a URL and stops at the next `*/` anywhere in the file, taking real
    // code with it. Same family as the bug it is fixing, one layer down.
    const code = codeOnly(`const u = "https://x.test/a"; function keep() { return 1; }`);
    expect(code).toMatch(/function\s+keep\s*\(\s*\)/);
  });

  it("does not treat a template's contents as code just because they contain `${}`", () => {
    // Regression pin for the scanner's own trap: it hands back a plain `}` at the end of a `${…}`
    // span and then lexes THE REST OF THE TEMPLATE AS CODE unless it is told to resume. Without the
    // re-scan the arm below is real code as far as any assertion can tell.
    const code = codeOnly("const d = `${a} case \"lookbook\": return <Lookbook />`;");
    expect(code).not.toMatch(ARM);
    expect(code, "the expression inside ${} IS code and must survive").toMatch(/\ba\b/);
  });

  it("survives an .astro file — frontmatter fences and template markup", () => {
    const astro = [
      "---",
      "// a comment naming case \"lookbook\": return <Lookbook />",
      'const x = 1;',
      "---",
      "<div>{x}</div>",
      '<code>case "{x}":</code>',
    ].join("\n");
    const code = codeOnly(astro);
    expect(code).not.toMatch(ARM);
    expect(code).toMatch(/const\s+x\s*=\s*1/);
  });
});

describe("textWithoutComments — for a claim about markup, not about code", () => {
  // The one guard that must NOT inert literals: markup concatenated into a JS string and assigned to
  // `innerHTML` is emitted markup, so `h1-floor.test.ts` has to see it.
  const src = 'const row = `<h1 class="x">hi</h1>`; // <h1>not emitted</h1>\n';

  it("keeps markup built inside a literal", () => {
    expect(textWithoutComments(src)).toMatch(/<\s*h1[\s>]/);
  });

  it("still drops comments — that half is what every hand-rolled stripper got wrong", () => {
    expect(textWithoutComments("// <h1>only in a comment</h1>\nconst x = 1;")).not.toMatch(/<\s*h1[\s>]/);
    expect(textWithoutComments("{/* <h1>only in a comment</h1> */}\nconst x = 1;")).not.toMatch(/<\s*h1[\s>]/);
  });

  it("is the wrong tool for a claim about code, and says so by failing loudly here", () => {
    // Pinned so nobody swaps the two by reflex: this is the exact smuggle `codeOnly` exists to stop.
    expect(textWithoutComments('const d = `case "lookbook": return <Lookbook />`;')).toMatch(ARM);
    expect(codeOnly('const d = `case "lookbook": return <Lookbook />`;')).not.toMatch(ARM);
  });
});
