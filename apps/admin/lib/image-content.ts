/**
 * What the uploaded BYTES actually are — Task 6.5 / SEC-17. PURE: no fs, no sharp, no server-only,
 * so a test can drive every branch with a Buffer. Same split as `platform-rank.ts` and
 * `route-roles.ts`, and for the same reason.
 *
 * 🔴 THE DEFECT THIS EXISTS FOR: nothing ever looked at the bytes. `checkFile` gated on
 * `file.type.startsWith("image/")` — a string the CLIENT sends — and `saveImage` branched on that
 * same string, so `Content-Type: image/svg+xml` made it write the body to disk **verbatim, unparsed**
 * under a `.svg` name we then serve. Any bytes at all could be stored that way. The raster path was
 * accidentally safe (sharp throws on rubbish); the SVG path had no check of any kind.
 *
 * ⚠️ THIS REFUSES. IT DOES NOT SANITISE, AND THAT IS THE DESIGN.
 * A partial strip is worse than none: it produces a file everyone then believes is clean. This
 * repository already carries that lesson for `set:html` on landing pages ("Do NOT fix this with a
 * regex sanitizer… a partial strip would restore exactly the false confidence"). So the rule here is
 * **an SVG carrying active constructs is REJECTED at the boundary**, and the merchant is told which
 * construct — never rewritten and stored as if it were safe.
 *
 * ⚠️ AND IT IS NOT THE EXECUTION BOUNDARY EITHER. That remains the serving header in
 * `app/api/uploads/[name]/route.ts` (`Content-Security-Policy: sandbox; default-src 'none'` +
 * `nosniff`), which stops script in an SVG a browser NAVIGATES to. This module narrows what gets
 * stored at all; the header is what makes a miss survivable. Two layers, deliberately — do not delete
 * one because the other exists.
 */

/** The raster formats we accept, keyed by the magic bytes that prove them. Order matters only for readability. */
const RASTER_MAGIC: ReadonlyArray<{ format: string; test: (b: Buffer) => boolean }> = [
  { format: "png", test: (b) => b.length > 8 && b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG" },
  { format: "jpeg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { format: "gif", test: (b) => b.toString("latin1", 0, 6) === "GIF87a" || b.toString("latin1", 0, 6) === "GIF89a" },
  // RIFF....WEBP — the four size bytes between the two markers are part of the container, not the tag.
  { format: "webp", test: (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
];

export type ImageKind = { kind: "raster"; format: string } | { kind: "svg" } | { kind: "unknown" };

/**
 * Classify by CONTENT. The client's `Content-Type` and the filename are both ignored here on purpose:
 * they are claims, and this function exists to check the claim.
 *
 * SVG detection has to survive what a real exporter writes before the root element — a UTF-8 BOM,
 * an XML prolog, a DOCTYPE, comments, whitespace. Inkscape and Illustrator both emit several of
 * those. Anything else in front of `<svg` and we return `unknown` rather than guess: a file that
 * needs guessing is exactly the file not to store.
 */
export function sniffImageKind(input: Buffer): ImageKind {
  for (const r of RASTER_MAGIC) if (r.test(input)) return { kind: "raster", format: r.format };

  // Only the head matters, and reading megabytes to find a root element would be silly.
  let head = input.subarray(0, 4096).toString("utf8");
  if (head.charCodeAt(0) === 0xfeff) head = head.slice(1); // BOM
  const stripped = head
    .replace(/^\s+/, "")
    .replace(/^<\?xml[^>]*\?>/i, "")
    .replace(/^\s*<!DOCTYPE[^>]*>/i, "")
    .replace(/^(?:\s*<!--[\s\S]*?-->)*/, "")
    .replace(/^\s+/, "");
  if (/^<svg[\s>]/i.test(stripped)) return { kind: "svg" };
  return { kind: "unknown" };
}

/**
 * Name the first ACTIVE construct in an SVG, or null when there is none. The caller refuses on a
 * non-null answer.
 *
 * ⚠️ Read this before extending it: **a miss here is not a hole, it is a fall-through to the CSP.**
 * That is why a list of patterns is acceptable here and would not be acceptable in a sanitiser — a
 * sanitiser's miss ships a file believed to be clean, while a refusal's miss ships a file the serving
 * header still sandboxes. Add patterns freely; never start rewriting the input.
 *
 * Whitespace is normalised first so `< script`, a newline inside the tag, or `on click =` cannot
 * walk past a pattern by formatting alone.
 */
const ACTIVE: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "<script>", re: /<\s*script[\s>]/i },
  { name: "<foreignObject>", re: /<\s*foreignObject[\s>]/i },
  { name: "<iframe>/<embed>/<object>", re: /<\s*(iframe|embed|object)[\s>]/i },
  // `on…=` event handlers. Requires the preceding character to be whitespace or `<` so ordinary
  // attribute names ending in "on" (`version`, `transform-origin`) cannot match.
  { name: "an on… event handler", re: /[\s<]on[a-z]+\s*=/i },
  { name: "a javascript: URL", re: /javascript\s*:/i },
  // Remote references: an external `href`, `xlink:href`, `src` or CSS `url()`/`@import`. A stored SVG
  // that fetches from someone else's server is a beacon on our origin even when it cannot script.
  { name: "a remote reference", re: /(?:href|src)\s*=\s*["']?\s*(?:https?:)?\/\//i },
  { name: "a remote CSS import", re: /@import/i },
  { name: "a remote url() reference", re: /url\(\s*["']?\s*(?:https?:)?\/\//i },
];

export function activeSvgConstruct(input: Buffer): string | null {
  const text = input.toString("utf8");
  for (const a of ACTIVE) if (a.re.test(text)) return a.name;
  return null;
}
