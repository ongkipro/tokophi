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

const BASE = process.argv[2] ?? "http://localhost:4327";

// Real devices, not the breakpoints we happened to pick:
// 320 = smallest phone still in use · 360 = the most common Android · 390/414 = modern iPhone
// 600 = phablet / split view · 768 = iPad portrait · 820/1024 = iPad landscape · 1280–1920 = desktop
const WIDTHS = [320, 360, 390, 414, 600, 768, 820, 1024, 1280, 1440, 1920];

const ROUTES = [
  "/",
  "/kategori/semua",
  "/kategori/dress",
  "/produk/dress-batik",
  "/blog",
  "/blog/cara-merawat-rajut",
  "/halaman/tentang-kami",
  "/keranjang",
  "/checkout",
  "/kontak",
];

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

// /keranjang and /checkout only render their real (widest) content with something in the cart.
await page.goto(`${BASE}/produk/dress-batik`, { waitUntil: "networkidle", timeout: 60_000 });
await page.locator("button:has-text('Keranjang')").first().click();
await page.waitForTimeout(300);

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
