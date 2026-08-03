// Prove `wake()` promotes the IMG's OWN `data-srcset`, not just the `<source>`'s.
//
// The carousel defers slides 2..n (`data-src`, woken on idle). When the img gained a `data-srcset`,
// only the `<source>` was being promoted — so waking a slide set `src` with no srcset and the browser
// committed to the full 1920×1080 original. Measured on production: 74 KB + 32 KB wasted on one page,
// on a phone, for images that are not even on screen yet.
//
// A srcset that is never promoted is invisible to every static check: the markup is right, the build
// is green, and the bytes are still wrong. Only a browser sees `currentSrc`.
//
// Normally run as part of the suite, which builds and starts the server for you:
//   npm run verify -w @tokophi/storefront
// Standalone, against a storefront you already have running (see check-env.mjs for the contract):
//   CHECK_BASE_URL=http://toko-demo.test:4390 node apps/storefront/scripts/check-hero-srcset.mjs
import { pageUrl, launchChromium } from "./check-env.mjs";
const T = pageUrl("/");
const b = await launchChromium();
const page = await b.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

const heroReqs = [];
page.on("request", (r) => { if (/\/hero\//.test(r.url())) heroReqs.push(r.url().split("/").pop()); });

await page.goto(T, { waitUntil: "load" });
// wake() runs on idle after load; give it room.
await page.waitForTimeout(3000);

const state = await page.evaluate(() =>
  [...document.querySelectorAll("img[data-hero-img]")].map((el) => ({
    hasDataSrcset: el.hasAttribute("data-srcset"),
    srcset: (el.getAttribute("srcset") || "").slice(0, 40),
    current: (el.currentSrc || el.src || "").split("/").pop(),
  })),
);
console.log("hero imgs:", JSON.stringify(state, null, 1));
console.log("hero files requested:", [...new Set(heroReqs)].sort());

// Every woken slide must have resolved to a WIDTH VARIANT, never the bare original, on a 412px screen.
const bad = state.filter((s) => s.current && !/-\d+w\.webp$/.test(s.current));
const stillPending = state.filter((s) => s.hasDataSrcset);
console.log("resolved to the full-size original:", bad.map((s) => s.current));
console.log("still holding data-srcset (not woken):", stillPending.length);
const ok = state.length > 0 && bad.length === 0 && stillPending.length === 0;
console.log(ok ? "PASS" : "FAIL");
await b.close();
process.exit(ok ? 0 : 1);
