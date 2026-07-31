// Generate responsive width variants for the storefront's STATIC images.
//
// WHY THIS EXISTS. `imageSrcSet` (src/data/catalog.ts) can only build a srcset for merchant uploads,
// because `/api/uploads/*` is served by the admin, whose route understands `?w=`. Seeded images under
// `public/` are plain files served by the storefront container — `?w=` there is a meaningless query
// string on the same full-size bytes, which is worse than no srcset (the browser would believe four
// renditions exist and pick a "200w" candidate that is really 1920px).
//
// Measured on production with Lighthouse, desktop: `uses-responsive-images` scored **0**, wasting
// **461 KiB** on one homepage — a 1920×1080 hero delivered whole to a 412 px phone. So the widths are
// made real, as files, ahead of time: no runtime resize endpoint to cache, invalidate or DoS, and the
// CDN treats them like any other immutable asset.
//
// Idempotent: a variant that already exists and is newer than its source is skipped, so re-running is
// free. Never UPSCALES — a variant wider than the source would be bytes for nothing.
//
// Run: node apps/storefront/scripts/gen-image-widths.mjs
import sharp from "sharp";
import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..", "public");

// Widths per directory, chosen from how the images are actually LAID OUT, not from a generic ladder:
//   hero/sections — full-bleed, so the widths track device widths (phone → 2× phone → laptop).
//   products      — a 2-col grid on mobile and a 4-col grid on desktop, so the rendered box is
//                   ~180–420 CSS px; 800 is kept as the top candidate for the PDP gallery.
const PLAN = [
  { dir: "hero", widths: [640, 1024, 1440] },
  { dir: "sections", widths: [640, 1024] },
  { dir: "products", widths: [200, 400] },
];

const variantName = (file, w) => file.replace(/\.webp$/, `-${w}w.webp`);

let made = 0,
  skipped = 0,
  bytes = 0;

for (const { dir, widths } of PLAN) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) continue;
  const files = (await readdir(abs)).filter((f) => f.endsWith(".webp") && !/-\d+w\.webp$/.test(f));
  for (const file of files) {
    const src = path.join(abs, file);
    const meta = await sharp(src).metadata();
    const srcStat = await stat(src);
    for (const w of widths) {
      if (w >= (meta.width ?? 0)) continue; // never upscale
      const out = path.join(abs, variantName(file, w));
      if (existsSync(out) && (await stat(out)).mtimeMs >= srcStat.mtimeMs) {
        skipped++;
        continue;
      }
      // quality 72: measured against the seed set, visually indistinguishable from the source at the
      // sizes these are displayed, and roughly half the bytes of the default 80.
      await sharp(src).resize({ width: w }).webp({ quality: 72, effort: 5 }).toFile(out);
      bytes += (await stat(out)).size;
      made++;
    }
  }
}

console.log(`generated ${made} variants (${Math.round(bytes / 1024)} KB), skipped ${skipped} up-to-date`);
