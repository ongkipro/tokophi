// Prove the OTHER routes do not hand the browser a full-size original for a thumbnail box either.
//
// `check-pdp-srcset` polices one page. Page-map finding SF-8 (Task 6.12) found the same class on
// eight more files: category tiles (`/`, `/kategori`) shipping the first product's original into a
// ~180–400 px box, the article hero and its "Baca juga" cards, the promo banner, the `/thanks` 80 px
// box, and the cart-sourced thumbnails on `/keranjang` (80 px), `/checkout` (56 px, plus the 36 px
// mobile summary bar) and `/checkout/sukses` (56 px). Measured before the fix, DPR 2, seeded store:
// a 600 px original into a 56 px box is **5,36×**, into the 36 px bar **8,33×**, into `/thanks` 3,85×.
//
// Same discipline as the PDP check, and for the same reasons — read that file's header before
// changing anything here:
//   1. structural — every catalog <img> on these routes carries `srcset` AND `sizes` (the store logo
//      excepted, as there; and see the ONE further exception below).
//   2. resolution — re-run the browser's own candidate selection through the isolated probe
//      (`?__pageprobe=`) and refuse any <img> that commits to more than 3× the device pixels it fills.
//      Run at THREE viewports, because every `sizes` here is a breakpoint expression derived from a
//      grid: 412 (phone), 768 (the `sm:` arm) and 1280 (where `max-w-7xl` pins) each exercise a
//      different arm, and an arm that over-claims is only visible at the width where it binds.
//
// ── THE ONE FURTHER EXCEPTION: a SEEDED image in the cart ─────────────────────────────────────────
//
// The cart thumbnails are built in the browser from `localStorage.cart[].image`, so no server helper
// runs. A MERCHANT UPLOAD (`/api/uploads/*`) takes `?w=` and the pages build that ladder client-side
// from the injected `UPLOAD_WIDTHS` — that is the production case, and it is asserted here with a
// seeded cart line pointing at an upload URL (the probe never fetches it, so the Seller app need not
// be running). A seeded `/products/*.webp` static image has real width files beside it, but WHICH
// rungs exist lives only in the 5 KB generated manifest, and shipping that to every visitor for a few
// thumbnails is the regression `check-search-srcset` refused. So on the cart routes a STATIC image
// without a srcset is printed as a NOTE, not failed: it is the demo store only, never a merchant.
// An UPLOAD without one on those routes is the defect and fails.
//
// ⚠️ Not exercised on the seeded data, and this file says so rather than pretending: `/` on the demo
// store is a Store Builder homepage, so `index.astro`'s fallback tile grid never renders there; and
// the demo has no promo banner. Both carry the same `imageSrcSet` + derived-`sizes` shape as the
// sites that ARE measured, and `astro check` compiles them; the sweep below still runs on both routes
// so any catalog <img> that does render there is held to the structural rule.
//
// Normally run as part of the suite:   npm run verify -w @tokophi/storefront
// Standalone:   CHECK_BASE_URL=http://toko-demo.test:4390 node apps/storefront/scripts/check-page-srcset.mjs
import { pageUrl, launchChromium } from "./check-env.mjs";

const DPR = 2;
const MAX_RATIO = 3;
const VIEWPORTS = [412, 768, 1280];
const PROBE = "__pageprobe";
const CATALOG = "\\/products\\/|\\/api\\/uploads\\/"; // a string: compiled inside the page too

// A cart with the two shapes a line can carry: a seeded static image and a merchant upload. The
// upload URL is never fetched — the probe stub answers every candidate — so it only has to LOOK like
// one to the page's own test, which is the same shape `isUploadUrl` accepts on the server.
// The upload is FIRST on purpose: `/checkout`'s mobile summary bar (`#summary2-thumb`, 36 px) shows
// `cart[0].image` only, and that is the box the original was worst in (8,33×).
const CART = [
  { handle: "upload-probe", catalogId: "", catalogType: "product", name: "Merchant upload", price: 100000, image: "http://localhost:3000/api/uploads/page-srcset-probe.webp", variant: "", size: "", qty: 1 },
  { handle: "dress-midi-bunga", catalogId: "", catalogType: "product", name: "Dress Midi Bunga", price: 189000, image: "/products/dress-midi-bunga.webp", variant: "M", size: "M", qty: 1 },
];
const LAST_ORDER = { number: "INV-CHECK", items: CART, subtotal: 289000, shipping: { price: 20000, courier: "spx" }, total: 309000, payment: { method: "cod" }, discount: 0, tax: 0 };
const SEED = `localStorage.setItem("cart", ${JSON.stringify(JSON.stringify(CART))}); localStorage.setItem("lastOrder", ${JSON.stringify(JSON.stringify(LAST_ORDER))});`;

// Constants, not env vars — see check-pdp-srcset.mjs for why a per-script knob is the wrong shape.
const ROUTES = [
  { path: "/", cart: false },
  { path: "/kategori", cart: false },
  { path: "/blog/batik-tulis-vs-cap", cart: false }, // a seeded article with a feature image
  { path: "/promo", cart: false },
  { path: "/thanks?lp=dress-midi-bunga&qty=1&subtotal=189000&shipping=20000", cart: false },
  { path: "/keranjang", cart: true },
  { path: "/checkout", cart: true },
  { path: "/checkout/sukses", cart: true },
];

const PIXEL = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const b = await launchChromium();

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const notes = [];

for (const vw of VIEWPORTS) {
  for (const r of ROUTES) {
    const ctx = await b.newContext({ viewport: { width: vw, height: 900 }, deviceScaleFactor: DPR });
    if (r.cart) await ctx.addInitScript(SEED);
    const page = await ctx.newPage();
    await page.route(new RegExp(PROBE), (route) => route.fulfill({ status: 200, contentType: "image/webp", body: PIXEL }));
    await page.goto(pageUrl(r.path), { waitUntil: "load" });
    await page.waitForTimeout(800); // the cart pages render from localStorage after load
    // A `loading="lazy"` <img> below the fold never selects a candidate until it nears the viewport
    // (measured: 11 of the builder homepage's grid tiles timed out at 1280 without this). Walk the
    // page once so every painted <img> has made its choice, then probe from the top.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 100));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);

    const imgs = await page.evaluate(
      async ({ PROBE, CATALOG }) => {
        const rx = new RegExp(CATALOG);
        // `[data-logo]` is Header.astro's store logo; CheckoutLayout's sits in its <header> without
        // the attribute. Both are a merchant upload of unknown aspect ratio rendered `w-auto`, the one
        // box no layout can derive a `sizes` for (see check-pdp-srcset).
        const els = [...document.querySelectorAll("img")].filter(
          (el) => rx.test(el.getAttribute("src") || "") && !el.closest("[data-logo]") && !el.closest("header"),
        );
        const meta = els.map((el, i) => ({
          i,
          src: (el.getAttribute("src") || "").split("?")[0],
          hasSrcset: !!el.getAttribute("srcset"),
          hasSizes: !!el.getAttribute("sizes"),
          box: Math.round(el.getBoundingClientRect().width),
          natural: el.naturalWidth || null,
          cands: (el.getAttribute("srcset") || "")
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean)
            .map((c) => {
              const [u, d] = c.split(/\s+/);
              return { u, w: /^\d+w$/.test(d || "") ? Number(d.slice(0, -1)) : null };
            }),
        }));
        for (const m of meta) {
          if (!m.cands.length) continue;
          els[m.i].setAttribute(
            "srcset",
            m.cands.map((c, k) => `${c.u}${c.u.includes("?") ? "&" : "?"}${PROBE}=${m.i}.${k}${c.w != null ? ` ${c.w}w` : ""}`).join(", "),
          );
        }
        // `box === 0` = not painted at this viewport (the desktop summary on a phone, a collapsed
        // mobile summary on a desktop); a lazy <img> there never selects, so there is nothing to
        // wait for and nothing to measure — the structural claim still covers it.
        const resolved = (m) => !m.cands.length || m.box === 0 || (els[m.i].currentSrc.includes(PROBE) && els[m.i].complete);
        // A `loading="lazy"` <img> defers a srcset change made while it is OUTSIDE the viewport until
        // it scrolls back in (measured: the builder homepage's three article cards, at the foot of
        // the page, never re-selected from the top). Bring each unsettled one into view while waiting;
        // the box was measured above, so scrolling changes nothing that is asserted.
        for (let t = 0; t < 100 && !meta.every(resolved); t++) {
          meta.filter((m) => !resolved(m)).forEach((m) => els[m.i].scrollIntoView({ block: "center" }));
          await new Promise((r) => setTimeout(r, 100));
        }
        return meta.map((m) => {
          const cur = els[m.i].currentSrc || "";
          const k = (cur.match(new RegExp(`${PROBE}=\\d+\\.(\\d+)`)) || [])[1];
          const picked = k != null ? m.cands[Number(k)] : null;
          return {
            src: m.src.split("/").pop(),
            upload: /\/api\/uploads\//.test(m.src),
            hasSrcset: m.hasSrcset,
            hasSizes: m.hasSizes,
            box: m.box,
            settled: resolved(m),
            width: picked ? picked.w : m.natural,
          };
        });
      },
      { PROBE, CATALOG },
    );
    await ctx.close();

    const tag = `${r.path.split("?")[0]} @${vw}`;
    const scored = imgs.map((i) => ({ ...i, ratio: i.box > 0 && i.width ? i.width / (i.box * DPR) : null }));

    // 1. structural. On a cart route a STATIC image may be bare (the note above); an upload may not.
    const bare = scored.filter((i) => !i.hasSrcset || !i.hasSizes);
    const tolerated = r.cart ? bare.filter((i) => !i.upload) : [];
    const offending = bare.filter((i) => !tolerated.includes(i));
    for (const i of tolerated) notes.push(`${tag}: ${i.src} is a seeded static image in the cart — bare by design (${i.box}px box)`);
    check(`${tag}: every catalog <img> carries srcset + sizes${r.cart ? " (uploads; seed images noted)" : ""}`, offending.length === 0, offending.map((i) => `${i.src} (${i.box}px box)`).join(", ") || `${imgs.length} images`);

    // 2. resolution, on the probe. A bare image that IS tolerated is still reported if it is grossly
    //    oversize — printed, not failed, so the number stays visible.
    const oversized = scored.filter((i) => i.box > 0 && i.hasSrcset && i.ratio !== null && i.ratio > MAX_RATIO);
    check(
      `${tag}: no srcset image exceeds ${MAX_RATIO}x its device pixels`,
      oversized.length === 0,
      oversized.map((i) => `${i.src} → ${i.width}px for a ${i.box}px box (${i.ratio.toFixed(1)}x)`).join("; ") ||
        scored.filter((i) => i.box > 0 && i.hasSrcset).map((i) => `${i.src} ${i.width}px/${i.box}px ${i.ratio?.toFixed(2)}x`).join(", "),
    );
    const unsettled = scored.filter((i) => !i.settled);
    check(`${tag}: every candidate re-resolved`, unsettled.length === 0, `${unsettled.length} timed out`);
  }
}

await b.close();
if (notes.length) console.log(`\nnotes (not failures):\n  ${[...new Set(notes)].join("\n  ")}`);
console.log(failures === 0 ? "\nPASS" : "\nFAIL");
process.exit(failures === 0 ? 0 : 1);
