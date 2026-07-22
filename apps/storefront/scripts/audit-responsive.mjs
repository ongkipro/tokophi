// Responsive guard for the storefront: sweeps every shopper-facing route across the widths people
// actually browse at, and fails if ANY of them can be scrolled sideways.
//
// Horizontal overflow is the one symptom that reliably means "the layout broke". It is invisible in
// a screenshot taken at a single width, and it is exactly what a shopper feels on a phone: the page
// drifts, the buy button hides off-screen, pinch-zoom fights back. So it gets checked mechanically
// instead of by remembering to drag a browser window.
//
// It found two real breaks the eye had missed, both on the PDP gallery, and both CSS sizing rules
// that are easy to get wrong:
//   · `flex-1` inside a `flex-col` sizes the HEIGHT — the width then fell out of `aspect-[3/4]` and
//     grew past the screen.
//   · below `md` the layout grid had no explicit template, so its single column was an IMPLICIT
//     `auto` track — and an auto track is sized from its CONTENT, free to exceed the container. The
//     thumbnail strip (5 × 64px + gaps = 368px) duly pushed it off a 360px phone.
//
// Run against a dev server:  npm run audit:responsive -w @tokophi/storefront
// Exits non-zero on a break, so it can gate a release.
import { chromium } from "playwright";

const ORIGIN = process.argv[2] ?? "http://localhost:4327";

// FOLLOW THE STORE'S PRIMARY DOMAIN, or this whole gate silently stops running.
//
// A store with an ACTIVE primary custom domain 301s every other host to it (middleware.ts) — and the
// demo store has had one since 2026-07-15. So `http://localhost:4327/produk` answers
// `301 → https://toko-demo.test/produk`, a name no dev machine resolves, and every route in the sweep
// died on ERR_NAME_NOT_RESOLVED. The audit did not report "0 breaks"; it crashed. But it crashed in a
// script nobody runs on a schedule, so the storefront went weeks with its responsive gate face-down.
//
// Fix: ask the server where it wants us, then point that name back at the dev port inside the browser
// (`--host-resolver-rules`) and browse it over http, so the redirect never fires. No DB row is touched
// — other agents share this database — and with no custom domain configured this is a no-op.
const probe = await fetch(`${ORIGIN}/produk`, { redirect: "manual" }).catch(() => null);
const moved = probe && probe.status >= 300 && probe.status < 400 && probe.headers.get("location");
const canonical = moved ? new URL(moved) : null;
const BASE = canonical ? `http://${canonical.host}` : ORIGIN;
const resolverArgs = canonical
  ? [`--host-resolver-rules=MAP ${canonical.host}:80 ${new URL(ORIGIN).host}`]
  : [];
if (canonical) console.log(`↪ toko ini kanonik di ${canonical.host} — dipetakan ke ${new URL(ORIGIN).host}\n`);

// Real devices, not the breakpoints we happened to pick:
// 320 = smallest phone still in use · 360 = the most common Android · 390/414 = modern iPhone
// 600 = phablet / split view · 768 = iPad portrait · 820/1024 = iPad landscape · 1280–1920 = desktop
const WIDTHS = [320, 360, 390, 414, 600, 768, 820, 1024, 1280, 1440, 1920];

const ROUTES = [
  "/",
  "/kategori/semua",
  "/kategori/dress",
  // The listing's control bar is the widest non-grid thing on the shop: category picker + a two-input
  // price range + a toggle + two buttons, all on one row. `?promo=1` forces every one of them to
  // render, and a filter that is ACTIVE also draws the "Reset filter" link — the state with the most
  // controls in the row is the only one worth sweeping.
  "/produk",
  "/produk?kategori=dress&promo=1",
  // The PDP is filled in below from the live listing, NOT named here. It used to read
  // `/produk/dress-batik`, which is `draft` in the demo store's normal state — so the sweep spent 11
  // widths measuring the 404 page while believing it was checking the product page whose gallery has
  // broken the layout twice. A route that silently becomes a different page is worse than a missing one.
  "__PDP__",
  "/blog",
  "/blog/cara-merawat-rajut",
  "/halaman/tentang-kami",
  "/keranjang",
  "/checkout",
  "/kontak",
];

const browser = await chromium.launch({ args: resolverArgs });
const page = await (await browser.newContext()).newPage();

// /keranjang and /checkout only render their real (widest) content with something in the cart.
//
// The product is TAKEN FROM THE LIVE LISTING, never hardcoded. This step used to open
// `/produk/dress-batik` by name — a handle that is `draft` in the demo store's normal state, so the
// page 404s, the buy button never appears, and the whole sweep dies on a 30s timeout before checking
// a single width. It only ever passed while that product happened to be temporarily active. A gate
// that depends on one row of demo data is a gate that goes dark the moment someone edits it.
const listing = await page.goto(`${BASE}/produk`, { waitUntil: "domcontentloaded", timeout: 60_000 });
if (!listing?.ok()) throw new Error(`/produk tidak bisa dibuka (${listing?.status()}) — server dev jalan?`);
const firstProduct = await page.locator("a[href^='/produk/']").first().getAttribute("href");
if (!firstProduct) throw new Error("Tidak ada produk di /produk — tidak ada yang bisa dimasukkan ke keranjang.");

await page.goto(BASE + firstProduct, { waitUntil: "networkidle", timeout: 60_000 });
// A sold-out product's buy button is DISABLED, so clicking it would hang here too. Fall through with
// an empty cart rather than die: /keranjang and /checkout still render, just narrower — a partial
// sweep beats no sweep, and the reason is printed rather than left as a silent gap.
const buy = page.locator("button:has-text('Keranjang')").first();
if (await buy.isEnabled({ timeout: 10_000 }).catch(() => false)) {
  await buy.click();
  await page.waitForTimeout(300);
} else {
  console.log(`⚠️  ${firstProduct} tidak bisa dimasukkan ke keranjang (habis / tanpa harga) — /keranjang & /checkout disapu dalam keadaan KOSONG.\n`);
}

ROUTES[ROUTES.indexOf("__PDP__")] = firstProduct;
console.log(`PDP yang disapu: ${firstProduct}\n`);

let broken = 0;

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(200);

    const result = await page.evaluate((vw) => {
      const overflow = document.documentElement.scrollWidth - vw;
      if (overflow <= 1) return { overflow, culprits: [] };

      // Ignore two kinds of "overflow" that are working as designed and never reach the document:
      //   · position:fixed subtrees — the mobile drawer is parked off-screen (translate-x-full).
      //   · anything inside a horizontal SCROLL container — a thumbnail strip is supposed to run
      //     wider than its box; it is clipped by it, and scrolls.
      const excused = (el) => {
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.position === "fixed") return true;
          if (cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflowX === "hidden") return true;
        }
        return false;
      };

      const culprits = [];
      for (const el of document.querySelectorAll("body *")) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.right <= vw + 1) continue;
        if (excused(el)) continue;
        const cls =
          typeof el.className === "string" && el.className
            ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
            : "";
        culprits.push(
          `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls} [w=${Math.round(box.width)}]`,
        );
      }
      return { overflow, culprits: [...new Set(culprits)].slice(0, 3) };
    }, width);

    // Overflow with no non-fixed culprit = an off-canvas element doing its job. Not a break.
    if (result.overflow > 1 && result.culprits.length > 0) {
      broken++;
      console.error(`FAIL ${route} @${width}px — overflows by ${result.overflow}px`);
      result.culprits.forEach((c) => console.error(`       ${c}`));
    }
  }
}

await browser.close();

const checks = ROUTES.length * WIDTHS.length;
if (broken > 0) {
  console.error(`\n${broken}/${checks} broken.`);
  process.exit(1);
}
console.log(`OK — ${checks} route×width combinations, no horizontal overflow.`);
