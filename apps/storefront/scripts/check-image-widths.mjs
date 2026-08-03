// Prove every descriptor in a STATIC srcset matches the file it points at.
//
// A `w` descriptor is the one field in a srcset candidate the browser cannot verify: it trusts the
// number, uses it to pick, and then paints whatever bytes arrive. So a descriptor is only as honest
// as the thing that produced it — and until this landed, it was produced by a per-directory CONSTANT:
// `/products/` was labelled `800w` while **14 of its 70 sources are 600 × 600** (over-claiming 33%,
// on the FIRST image of every product — the one on every card, every mega-menu thumbnail and every
// PDP), and `/sections/` was labelled `1920w` for one 1200 px file (over-claim 60%) and one 2000 px
// file (under-claim). Only `/hero/` was telling the truth. Nothing anywhere read the files.
//
// So this check reads the FILES. It is the guard on `src/data/static-image-widths.ts`, which
// `gen-image-widths.mjs` generates and `staticSrcSet` (src/data/catalog.ts) turns into every static
// srcset the storefront emits. Four claims, each a separate way for a srcset to lie:
//
//   1. every manifest source exists and its `w` IS its real intrinsic width  (the descriptor)
//   2. every rung listed in `v` exists on disk                               (a 404 the browser may
//                                                                             pick as its best
//                                                                             candidate)
//   3. every rung's real width IS the width its filename claims              (a resize that drifted)
//   4. no source file on disk is MISSING from the manifest                   (someone added an image
//                                                                             and did not re-run the
//                                                                             generator — silently
//                                                                             no srcset at all)
//
// No browser and no server: it is disk versus disk, so it runs anywhere and cannot flake.
//
//   node apps/storefront/scripts/check-image-widths.mjs
import sharp from "sharp";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { STATIC_IMAGE_WIDTHS } from "../src/data/static-image-widths.ts";

const PUBLIC = path.join(import.meta.dirname, "..", "public");
const DIRS = [...new Set(Object.keys(STATIC_IMAGE_WIDTHS).map((u) => u.split("/")[1]))];

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const widthOf = async (rel) => (await sharp(path.join(PUBLIC, rel)).metadata()).width ?? 0;

const missingSrc = [];
const wrongSrc = [];
const missingRung = [];
const wrongRung = [];

for (const [url, { w, v }] of Object.entries(STATIC_IMAGE_WIDTHS)) {
  if (!existsSync(path.join(PUBLIC, url))) {
    missingSrc.push(url);
    continue;
  }
  const real = await widthOf(url);
  if (real !== w) wrongSrc.push(`${url} claims ${w}w, is ${real}px`);
  for (const rung of v) {
    const rel = url.replace(/\.webp$/, `-${rung}w.webp`);
    if (!existsSync(path.join(PUBLIC, rel))) {
      missingRung.push(rel);
      continue;
    }
    const rw = await widthOf(rel);
    if (rw !== rung) wrongRung.push(`${rel} is ${rw}px`);
  }
}

// The reverse direction: a source on disk that the manifest has never heard of. It is not a broken
// image — `staticSrcSet` returns undefined and the img renders exactly as it did before srcsets
// existed — but it is a silent loss of every rendition, which is how this class hides.
const orphans = [];
for (const dir of DIRS) {
  const abs = path.join(PUBLIC, dir);
  if (!existsSync(abs)) continue;
  for (const f of await readdir(abs)) {
    if (!f.endsWith(".webp") || /-\d+w\.webp$/.test(f)) continue;
    if (!STATIC_IMAGE_WIDTHS[`/${dir}/${f}`]) orphans.push(`/${dir}/${f}`);
  }
}

const n = Object.keys(STATIC_IMAGE_WIDTHS).length;
check(`the manifest describes every static image (${DIRS.map((d) => "/" + d + "/").join(" ")})`, n > 0, `${n} sources`);
check(`every manifest source exists on disk`, missingSrc.length === 0, missingSrc.join(", "));
check(`every source's declared width IS its real width`, wrongSrc.length === 0, wrongSrc.join("; "));
check(`every listed rendition exists on disk`, missingRung.length === 0, missingRung.join(", "));
check(`every rendition's real width matches its filename`, wrongRung.length === 0, wrongRung.join("; "));
check(`no source on disk is missing from the manifest`, orphans.length === 0, orphans.length ? `${orphans.join(", ")} — re-run gen-image-widths.mjs` : "");

const byDir = {};
for (const [url, { w }] of Object.entries(STATIC_IMAGE_WIDTHS)) (byDir[url.split("/")[1]] ??= []).push(w);
console.log(
  "\nreal source widths: " +
    Object.entries(byDir)
      .map(([d, ws]) => `/${d}/ ${ws.length} file(s) ${[...new Set(ws)].sort((a, b) => a - b).join("/")}px`)
      .join(" · "),
);

console.log(failures === 0 ? "PASS" : "FAIL");
process.exit(failures === 0 ? 0 : 1);
