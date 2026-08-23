import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { activeSvgConstruct, sniffImageKind } from "./image-content";

// The ONE place an uploaded image becomes a file on disk. Extracted from lib/actions/media.ts so the
// store logo/favicon can reuse it — two copies of the encode/resize rules would drift, and the day
// they disagree is the day a merchant's logo is silently re-encoded differently from their product
// photos.
//
// ⚠️ NOT a "use server" module, deliberately. In a "use server" file EVERY export becomes a callable
// server action — exporting `saveImage` from there would publish an arbitrary-file-writer as an RPC
// endpoint reachable by anyone who can guess the action id. `import "server-only"` keeps it on the
// server without making it a boundary.
//
// - PNG/JPG/GIF → WebP q82.
// - Already WebP within MAX_DIM → re-encoded at q92 and kept ONLY IF the result is genuinely smaller;
//   otherwise the uploaded bytes are stored untouched. See the note in saveImage — "shrink if possible"
//   has to mean measured, never assumed.
// - Already WebP but oversized → resized + re-encoded at q92 (high quality) to avoid degradation.
// - SVG → passthrough (vector, not raster; sharp would rasterise it and throw away the whole point).
//   Deliberate: an SVG is already tiny and resolution-independent; converting it to WebP would make it
//   BIGGER and blurry at the same time. Do not "fix" this by treating it like every other image.
//
// The ORIGINAL IS NEVER WRITTEN TO DISK. The upload arrives as a Buffer, is converted in memory, and
// only the `.webp` (or the passthrough `.svg`) is written — so there is no original file to clean up
// afterwards, and no window in which one exists. Do not add an "delete the original" step: there is
// nothing to delete, and a delete keyed on a guessed original filename would be a path-traversal
// primitive for free.

export const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
export const MAX_BYTES = 2 * 1024 * 1024; // 2MB (clients also enforce, but this is the boundary)
const MAX_DIM = 2000; // px — cap the long edge so files stay lean

export type SavedImage = {
  url: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
};

export async function saveImage(input: Buffer, mime: string, baseName: string): Promise<SavedImage> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  // ── Task 6.5 / SEC-17 — the BYTES decide, not the caller's `mime` ─────────────────────────────
  // `mime` arrives as `file.type`: a string the client sends. It used to pick the branch below, so
  // `Content-Type: image/svg+xml` wrote ANY body to disk unparsed under a name we then serve. The
  // sniff is the gate now; `mime` is only a claim we cross-check against it.
  const kind = sniffImageKind(input);
  if (kind.kind === "unknown") throw new Error("file is not a supported image");
  if ((mime === "image/svg+xml") !== (kind.kind === "svg")) {
    // Declared one thing, contains another. Refused rather than believed-and-stored: whichever half
    // is wrong, we would be writing a file whose extension does not describe its content.
    throw new Error("file content does not match its declared type");
  }

  if (kind.kind === "svg") {
    // REFUSE active SVG; never strip it. A partial strip stores a file everyone then trusts —
    // the same reasoning `set:html` carries for landing pages. The serving route's
    // `sandbox; default-src 'none'` stays the execution boundary for anything this misses.
    const active = activeSvgConstruct(input);
    if (active) throw new Error(`SVG berisi ${active} — hapus bagian itu lalu unggah lagi`);
    const name = `${baseName}.svg`;
    await fs.writeFile(path.join(UPLOAD_DIR, name), input);
    return { url: `/api/uploads/${name}`, mime, size: input.length, width: null, height: null };
  }
  const meta = await sharp(input).metadata();
  const oversized = (meta.width ?? 0) > MAX_DIM || (meta.height ?? 0) > MAX_DIM;
  let out: Buffer;
  if (mime === "image/webp" && !oversized) {
    // A WebP already within MAX_DIM used to be stored byte-for-byte. Now we TRY to shrink it — WebPs
    // in the wild often leave an exporter at a needlessly high quality — but the re-encode is kept
    // ONLY if it genuinely wins. That comparison is the whole feature, not a safety net:
    //
    //   MEASURED on this repo's own images (2026-07-20). Every one of 7 real files got BIGGER when
    //   re-encoded — blazer-wanita-2 10,962 → 13,590 B, cara-mencuci-batik 67,038 → 82,480 B — because
    //   they were already well compressed and a re-encode pays a fresh header plus generation loss.
    //   A simulated exporter-quality file (q100, 199,888 B) came down to 85,468 B: **57% saved**.
    //   So this fires for bloated uploads and stands aside for good ones, which is the point.
    //
    // Re-encode at q92, HIGHER than the q82 used for PNG/JPG, deliberately: we do not know the source
    // quality, so the only honest trade is "shrink at near-original fidelity or do not shrink at all".
    // Attempting at a LOW quality would win on size almost every time — by throwing away pixels the
    // merchant did not agree to lose. Ties keep the original: same bytes, one less generation of loss.
    //
    // effort 4, not 6: measured 112ms vs 277ms on a 200 KB file for a 0.4pp difference in output size.
    // saveImage runs inside the upload's DB transaction (the tenant guard has to precede the write),
    // so this is time a connection is held — 2.5x the CPU to save 0.4% is not a trade worth making.
    const shrunk = await sharp(input).rotate().webp({ quality: 92, effort: 4 }).toBuffer();
    out = shrunk.length < input.length ? shrunk : input;
  } else {
    let img = sharp(input).rotate(); // honor EXIF orientation
    if (oversized) img = img.resize({ width: MAX_DIM, height: MAX_DIM, fit: "inside", withoutEnlargement: true });
    out = await img.webp(mime === "image/webp" ? { quality: 92, effort: 4 } : { quality: 82 }).toBuffer();
  }
  const name = `${baseName}.webp`;
  await fs.writeFile(path.join(UPLOAD_DIR, name), out);
  const fin = await sharp(out).metadata();
  return { url: `/api/uploads/${name}`, mime: "image/webp", size: out.length, width: fin.width ?? null, height: fin.height ?? null };
}

/** The favicon's rendered size. 512 is the largest any consumer asks for (PWA manifests, Android
 *  home-screen); the browser tab uses 16–32. One square source covers all of them. */
const FAVICON_PX = 512;

/**
 * A favicon is NOT a photo, so it does not go through `saveImage`.
 *
 * Two things are different and both matter:
 *
 * 1. **It is written as PNG, not WebP.** `saveImage` converts everything to WebP, and the favicon was
 *    going through it — so a merchant who uploaded a PNG got a `.webp` favicon. PNG is universally
 *    supported as a tab icon; WebP's support as a *favicon* (as opposed to as an image) is not
 *    something worth betting a merchant's tab icon on. The file is a few KB and cached indefinitely,
 *    so WebP buys nothing here, and being wrong costs a missing icon. `store-profile.ts` has argued
 *    "a PNG favicon is universally supported" in a comment for a while — the pipeline just wasn't
 *    doing it.
 * 2. **It is squared and padded, not cropped.** A tab icon is square; a rectangular upload had to
 *    become square somewhere, and letting the browser do it stretches the merchant's mark. `contain`
 *    + a transparent background preserves the artwork and centres it.
 *
 * Accepts ANY raster format sharp can decode (PNG, JPG, WebP, GIF, AVIF, TIFF, HEIF) — the merchant
 * should not have to convert anything by hand. SVG stays out: see the note in store-profile.ts.
 */
export async function saveFavicon(input: Buffer, baseName: string): Promise<SavedImage> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const out = await sharp(input)
    // ⚠️ NO `withoutEnlargement`, and this is deliberate — I tried it and it is a REGRESSION.
    // With `fit: "contain"` the canvas is 512×512 either way; `withoutEnlargement` only stops the
    // CONTENT growing. So a 64px mark would sit centred in a 512px canvas filling 12% of it, and in a
    // 16px browser tab the mark would render about 2px wide, surrounded by transparency. Upscaling
    // costs nothing here precisely because the icon is ALWAYS displayed smaller than 512 — going
    // 64 → 512 → 16 lands in the same place as 64 → 16. Fill the icon.
    .resize(FAVICON_PX, FAVICON_PX, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    // `palette` shrinks a flat icon dramatically (a logo mark is usually a handful of colours) with no
    // visible loss; `compressionLevel: 9` is free at this size — it is encoded once, ever.
    .png({ palette: true, compressionLevel: 9 })
    .toBuffer();
  const name = `${baseName}.png`;
  await fs.writeFile(path.join(UPLOAD_DIR, name), out);
  // Real dimensions, read back from the encoded file — not the constant we asked for. With
  // `withoutEnlargement` those differ for any source under 512px, and a `media` row that lies about
  // its own size is the kind of small untruth that later gets trusted.
  const fin = await sharp(out).metadata();
  return {
    url: `/api/uploads/${name}`,
    mime: "image/png",
    size: out.length,
    width: fin.width ?? null,
    height: fin.height ?? null,
  };
}

/** The server-side gate on an upload. The client's `accept=` attribute is UX; this is the boundary —
 *  a hand-rolled POST does not honour an HTML attribute. */
export function checkFile(file: FormDataEntryValue | null): asserts file is File {
  if (!(file instanceof File) || file.size === 0) throw new Error("no file");
  if (!file.type.startsWith("image/")) throw new Error("not an image");
  if (file.size > MAX_BYTES) throw new Error("file too large");
}

/** Where `app/api/uploads/[name]/route.ts` caches its `?w=` renditions. Named here so the delete
 *  path below can sweep them — a derivative that outlives its original is a file nothing will ever
 *  serve or clean up again. */
const RESIZE_CACHE_DIR = path.join(UPLOAD_DIR, ".resized");

/** Delete a file previously written by saveImage, plus any resized renditions the uploads route
 *  cached from it. Tolerates an already-missing file: a merchant replacing a logo must not be
 *  blocked because the old one vanished from disk. Refuses anything that is not one of our own
 *  `/api/uploads/<name>` urls — a path from a DB column is still input, and `../../` in a filename
 *  must not reach fs.unlink. */
export async function deleteImageFile(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const m = /^\/api\/uploads\/([A-Za-z0-9._-]+)$/.exec(url);
  if (!m) return;
  const name = m[1];
  await fs.unlink(path.join(UPLOAD_DIR, name)).catch(() => {});
  // Renditions are `<name>.w<width>.webp`. Listing and filtering (rather than looping the width
  // list) keeps this correct if the route's allow-list ever changes — the cleanup must not need a
  // matching edit in two files to stay honest.
  const derived = await fs.readdir(RESIZE_CACHE_DIR).catch(() => [] as string[]);
  await Promise.all(
    derived
      .filter((f) => f.startsWith(`${name}.w`))
      .map((f) => fs.unlink(path.join(RESIZE_CACHE_DIR, f)).catch(() => {})),
  );
}
