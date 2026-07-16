import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

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
// - Already WebP within MAX_DIM → stored AS-IS (no re-encode, zero pixel loss).
// - Already WebP but oversized → resized + re-encoded at q92 (high quality) to avoid degradation.
// - SVG → passthrough (vector, not raster; sharp would rasterise it and throw away the whole point).

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
  if (mime === "image/svg+xml") {
    const name = `${baseName}.svg`;
    await fs.writeFile(path.join(UPLOAD_DIR, name), input);
    return { url: `/api/uploads/${name}`, mime, size: input.length, width: null, height: null };
  }
  const meta = await sharp(input).metadata();
  const oversized = (meta.width ?? 0) > MAX_DIM || (meta.height ?? 0) > MAX_DIM;
  let out: Buffer;
  if (mime === "image/webp" && !oversized) {
    out = input; // already WebP + right size → keep exactly as uploaded (pixel-perfect)
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

/** The server-side gate on an upload. The client's `accept=` attribute is UX; this is the boundary —
 *  a hand-rolled POST does not honour an HTML attribute. */
export function checkFile(file: FormDataEntryValue | null): asserts file is File {
  if (!(file instanceof File) || file.size === 0) throw new Error("no file");
  if (!file.type.startsWith("image/")) throw new Error("not an image");
  if (file.size > MAX_BYTES) throw new Error("file too large");
}

/** Delete a file previously written by saveImage. Tolerates an already-missing file: a merchant
 *  replacing a logo must not be blocked because the old one vanished from disk. Refuses anything that
 *  is not one of our own `/api/uploads/<name>` urls — a path from a DB column is still input, and
 *  `../../` in a filename must not reach fs.unlink. */
export async function deleteImageFile(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const m = /^\/api\/uploads\/([A-Za-z0-9._-]+)$/.exec(url);
  if (!m) return;
  await fs.unlink(path.join(UPLOAD_DIR, m[1])).catch(() => {});
}
