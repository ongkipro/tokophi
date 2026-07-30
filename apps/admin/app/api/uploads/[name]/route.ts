import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

// Serve runtime-uploaded media. `next start` only serves files that were in public/ AT BUILD TIME,
// so images uploaded after the build (public/uploads/) 404 via the static handler — this route
// streams them from disk instead. Public (no auth) so the storefront can show product images.
export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const TYPES: Record<string, string> = { webp: "image/webp", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif" };

// ── ?w= — RESPONSIVE RENDITIONS ───────────────────────────────────────────────────────────────────
//
// `saveImage` caps the long edge at MAX_DIM = 2000, so a merchant's fashion photo is a 200-400 KB
// WebP — served into a product card that is 156 CSS px wide on a 360px phone. This route (not a
// static host) serves those bytes, so it is the one place that can fix it for images ALREADY
// UPLOADED, without a re-encode pass over everyone's media.
//
// ⚠️ `w` MUST come from this ALLOW-LIST. It is not validation politeness — an open integer here is
// two vulnerabilities at once:
//   1. CPU-DoS: every distinct value is a fresh sharp decode+resize of a 2000px image on the origin.
//   2. Cache poisoning/eviction: Cloudflare keys by full URL, so `?w=1,2,3,…` mints unbounded cache
//      entries and evicts the zone's real ones. The allow-list bounds an image at 5 keys (original
//      + 4 widths) — permanently, not per-attacker.
//
// Widths chosen from the two real consumers (see the `sizes` derivations in ProductCard.astro and
// produk/[handle].astro): a card is 156-296 CSS px and a PDP main image 260-492 CSS px. So 200 and
// 400 cover cards at DPR 1-2, 800 covers a card at DPR 3 and the PDP at DPR 2, and 1200 covers the
// PDP at DPR 3. Above that the 2000px original is the answer and there is nothing to serve.
const WIDTHS = [200, 400, 800, 1200] as const;

// An out-of-list `w` is REJECTED (400), not silently ignored. Serving the original would be the
// friendlier-looking choice and it is the wrong one: `?w=1` would then still be a valid URL that
// Cloudflare caches — holding a 400 KB body under an attacker-chosen key. The whole point of the
// allow-list is to bound the key space, and ignoring the param does not bound it. Rejecting also
// costs the origin nothing: we bail before touching the disk. `no-store` keeps the error itself out
// of any cache. We generate every `?w=` URL ourselves, so no legitimate client can hit this.
const badWidth = () =>
  new Response("bad width", { status: 400, headers: { "Cache-Control": "no-store" } });

// Derivatives are cached on disk next to the originals. Cloudflare does make the origin cold-path
// rare — each width is its own immutable URL, so a hot image is resized once ever — but "rare" is
// not "once": CDN entries are evicted by LRU, and a multi-tenant shop's long tail of product photos
// is cold most of the time. Paying a ~150ms sharp decode+resize on every cache miss is a slow image
// on exactly the pages that were already slow. The write is idempotent and content is immutable
// (`saveImage` mints a fresh basename per upload — a name is never rewritten), so a cached
// derivative can never go stale. `deleteImageFile` sweeps this directory when the original goes.
const CACHE_DIR = path.join(UPLOAD_DIR, ".resized");

const IMMUTABLE = "public, max-age=31536000, immutable";

// ── WHY AN UPLOADED SVG IS A SCRIPT, AND WHAT STOPS IT ────────────────────────────────────────────
//
// This route is PUBLIC and serves whatever a merchant uploaded, under `app.tokophi.com`. `saveImage`
// stores SVG byte-for-byte (deliberately — see the pass-through below), and `checkFile` accepts it
// because `image/svg+xml` starts with "image/". But an SVG is an XML document: `<svg><script>` runs,
// on THIS origin, with the admin's cookies in scope, the moment anyone NAVIGATES to the URL.
//
// It is not self-XSS. `media:write` is held by `staff` in every tenant, so any store's staff can host
// a payload on the admin origin and send the link to another store's owner — the link looks like our
// own domain because it is.
//
// `sandbox` (with no `allow-scripts`) is what actually stops execution; `default-src 'none'` stops the
// document reaching back out for anything. Both are inert for the normal case — an `<img src>` never
// runs SVG script anyway — so this costs legitimate logos and favicons nothing.
//
// ⚠️ Do NOT "fix" this by rejecting SVG at upload instead: logos and favicons are legitimately vector,
// and rasterising them is the bug `saveImage` already refuses to introduce. The header is the fix.
const SVG_SANDBOX = "sandbox; default-src 'none'; style-src 'unsafe-inline'";

// `nosniff` on EVERY response, not just the SVG one: without it a browser may ignore our
// Content-Type and sniff an `application/octet-stream` body (the fallback for an unknown extension)
// into something executable. The header is the whole mitigation for that class.
const NOSNIFF = { "X-Content-Type-Options": "nosniff" };

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return new Response("bad request", { status: 400 }); // no path traversal

  // ⚠️ Matched as a STRING against the canonical decimal form, not parsed with Number(). Parsing
  // would accept `400.0`, ` 400`, `+400`, `4e2`, `0400` — all the same image, all DIFFERENT URLs,
  // and therefore different Cloudflare cache keys. That is the exact unbounded-key-space the
  // allow-list exists to prevent, smuggled back in through numeric coercion. Exact-match keeps the
  // promise real: at most one URL per (image, width).
  const raw = new URL(req.url).searchParams.get("w");
  let width = 0;
  if (raw !== null) {
    const match = WIDTHS.find((w) => String(w) === raw);
    if (match === undefined) return badWidth();
    width = match;
  }

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[ext] ?? "application/octet-stream";

  try {
    // SVG passes through UNRESIZED, always. It is a vector: it is already tiny, already
    // resolution-independent, and sharp would rasterise it — bigger AND blurry at once. Same rule
    // as `saveImage`, and it must stay the same rule.
    if (!width || ext === "svg") {
      const buf = await fs.readFile(path.join(UPLOAD_DIR, name));
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": type,
          "Cache-Control": IMMUTABLE,
          ...NOSNIFF,
          // Only the SVG branch needs the sandbox; a raster body cannot execute.
          ...(ext === "svg" ? { "Content-Security-Policy": SVG_SANDBOX } : {}),
        },
      });
    }

    const cached = path.join(CACHE_DIR, `${name}.w${width}.webp`);
    const hit = await fs.readFile(cached).catch(() => null);
    if (hit) {
      return new Response(new Uint8Array(hit), {
        headers: { "Content-Type": "image/webp", "Cache-Control": IMMUTABLE, ...NOSNIFF },
      });
    }

    const src = await fs.readFile(path.join(UPLOAD_DIR, name));
    const meta = await sharp(src).metadata();

    // Requested width >= the source → serve the ORIGINAL. Never upscale: it costs CPU and bytes to
    // invent detail that is not there. (This is also why no `withoutEnlargement` option appears
    // below — the check above already makes enlargement unreachable. The note in `image-store.ts`
    // about `withoutEnlargement` being tried and REVERTED is about `saveFavicon`, where `fit:
    // "contain"` pads to a fixed 512 canvas and suppressing enlargement left a small mark floating
    // in mostly-transparent space. There is no canvas here — only a width — so that trap does not
    // apply, and neither does the option.)
    if ((meta.width ?? 0) <= width) {
      return new Response(new Uint8Array(src), {
        headers: {
          "Content-Type": type,
          "Cache-Control": IMMUTABLE,
          ...NOSNIFF,
          // Reachable for an SVG only if a `?w=` slipped through; belt and braces.
          ...(ext === "svg" ? { "Content-Security-Policy": SVG_SANDBOX } : {}),
        },
      });
    }

    const out = await sharp(src)
      // `.rotate()` bakes in EXIF orientation. Not redundant with `saveImage`: its "already WebP,
      // within MAX_DIM, re-encode did not win" branch stores the uploaded bytes UNTOUCHED, so a
      // stored file can still carry an orientation tag. sharp strips metadata on output, so
      // resizing without this would leave the derivative rotated relative to the original.
      .rotate()
      .resize({ width, fit: "inside" })
      // q82, matching `image-store.ts`'s PNG/JPG branch — NOT the q92 it uses when re-encoding an
      // already-WebP upload at full size. That q92 exists because the master is the merchant's
      // artifact and we must not quietly spend fidelity they did not agree to lose. A derivative is
      // a delivery rendition displayed at exactly this width: the downsample is already the
      // dominant transform, and q82 is the standard delivery trade. The master on disk is untouched.
      // effort is sharp's default 4 — `image-store.ts` measured 6 as 2.5x the CPU for 0.4pp.
      .webp({ quality: 82 })
      .toBuffer();

    // Write via a unique temp name + rename so two concurrent requests for the same width cannot
    // interleave into a half-written file that is then served forever under an immutable header.
    // Cache failures are swallowed: a full disk must degrade to "resize every time", never to a
    // broken image.
    const tmp = `${cached}.${process.pid}-${Date.now()}.tmp`;
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(tmp, out);
      await fs.rename(tmp, cached);
    } catch {
      await fs.unlink(tmp).catch(() => {});
    }

    return new Response(new Uint8Array(out), {
      headers: { "Content-Type": "image/webp", "Cache-Control": IMMUTABLE, ...NOSNIFF },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
