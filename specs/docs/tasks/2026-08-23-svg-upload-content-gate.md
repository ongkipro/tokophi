# Task 6.5 / SEC-17 — the upload gate looks at the BYTES, and refuses active SVG

**Status:** done · merged via `sec/task-6.5-svg-content-gate`
**Requirement:** `SEC-17` (root `TASKS.md` → Task 6.5)

## The defect

Nothing ever looked at the bytes. `checkFile` gated on `file.type.startsWith("image/")` — a string the
CLIENT sends — and `saveImage` branched on that same string, so `Content-Type: image/svg+xml` made it
write the body to disk **verbatim, unparsed**, under a `.svg` name we then serve. Any bytes at all
could be stored that way. The raster path was accidentally safe (sharp throws on rubbish); the SVG
path had no check of any kind.

## The shape, and why it is a refusal

**It refuses. It does not sanitise, and that is the design.** A partial strip produces a file everyone
then believes is clean. This repo already carries that lesson for `set:html` on landing pages ("Do NOT
fix this with a regex sanitizer… a partial strip would restore exactly the false confidence"). So an
SVG carrying active constructs is rejected at the boundary and the merchant is told *which* construct.

**It is also not the execution boundary.** That remains the serving header in
`app/api/uploads/[name]/route.ts` (`Content-Security-Policy: sandbox; default-src 'none'` + `nosniff`).
This module narrows what gets stored; the header is what makes a miss survivable. Two layers,
deliberately — do not delete one because the other exists. That asymmetry is what makes a pattern list
acceptable here and unacceptable in a sanitiser: **a miss here is a fall-through to the CSP, not a hole.**

## Where it went, and why not where TASKS.md said

TASKS.md names `apps/admin/lib/actions/media.ts`. The gate went into **`apps/admin/lib/image-store.ts`**
instead, at the top of `saveImage`. `saveImage` has **two** importers — `lib/actions/media.ts` (product
media) and `lib/actions/store-profile.ts` (the store logo, which is exactly where someone uploads an
SVG). Gating in `media.ts` would have left the logo path open. One guard in the shared function is a
smaller diff than one per caller, and it cannot be missed by a third caller added later.

- `apps/admin/lib/image-content.ts` — NEW, **pure** (no fs, no sharp, no `server-only`), so a test drives
  every branch with a `Buffer`. Same split as `platform-rank.ts` and `route-roles.ts`.
  - `sniffImageKind(buf)` → `{kind:"raster",format}` | `{kind:"svg"}` | `{kind:"unknown"}`, by magic
    bytes (PNG/JPEG/GIF/WEBP) and an SVG root element that survives BOM + XML prolog + DOCTYPE +
    comments (Inkscape and Illustrator between them emit every one of those; a stricter test would
    reject real logos). Anything else in front of `<svg` is `unknown` rather than a guess.
  - `activeSvgConstruct(buf)` → the name of the first offending construct, or `null`.
- `apps/admin/lib/image-store.ts` — the gate: `unknown` → refuse; declared MIME and sniffed kind must
  agree (that is the MIME/extension-mismatch half of the requirement); `svg` → refuse on a named
  construct.

## Verification

- `apps/admin/lib/image-content.test.ts` — **16 tests, all green**; full repo `npx vitest run`
  **126 files / 1041 tests**, all passing.
- Constructs proved refused: `<script>` (incl. `< script >`), `<foreignObject>`,
  `<iframe>/<embed>/<object>`, `on…=` handlers (incl. whitespace around `=` and a newline before the
  attribute), `javascript:` URLs, remote `href`/`src`, `@import`, remote `url()`.
- Proved ACCEPTED: an ordinary logo carrying `version=`, `transform-origin=`, `font-family=`,
  `font=` and a **local** `use href='#glyph'`.

### Two things this cost, recorded so they are not re-learned

1. **A test asserted `<rect on click='x'/>` is an event handler. It is not** — that parses as an
   attribute `on` plus an attribute `click`, neither of which executes. The pattern correctly refused
   to match it. **The assertion was wrong, not the code**, and it was the assertion that was fixed.
2. **Mutation M3 (dropping the `[\s<]` prefix from the handler pattern) stayed GREEN** — which made
   the prefix look like decoration. It is not: without it, `on[a-z]+\s*=` matches the `ont=` inside
   `font="italic 12px Inter"`, a legitimate SVG presentation attribute, so every logo carrying it would
   be refused as if it held an event handler. `font=` was **missing from the pass-through fixture**;
   adding it turned M3 red. (`font-family=` does not match either way — the `[a-z]+` stops at the
   hyphen — so only the bare form proves the point.)

## What is NOT claimed

That a rejected file could have executed. Execution is stopped by the serving header. This suite only
proves what is allowed to be **stored**.
