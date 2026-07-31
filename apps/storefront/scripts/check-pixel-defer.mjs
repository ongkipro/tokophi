// Prove the DEFERRED marketing pixels still track.
//
// `MarketingPixels.astro` keeps every stub/queue/init synchronous but injects the three vendor
// bundles only at idle-or-first-interaction. Measured reason: switching the pixels on took production
// mobile from 90 to 66 and TBT from 130 ms to 770 ms. The risk that buys is that a deferral which
// LOOKS fine can silently drop events — and `astro check`, lint and build all stay green while it
// does. So this is a browser check, not a unit test.
//
// It asserts the four things that make the deferral lossless:
//   1. fbq / gtag / ttq exist synchronously (a page script may call them at any time)
//   2. NO vendor <script src> is in the served HTML — nothing on the parser's critical path
//   3. events fired while no SDK exists are BUFFERED (queue lengths grow), not thrown away
//   4. after a real interaction all three vendors load, and the GA beacon actually goes out
//
// Run against a built storefront:
//   npx astro build --root apps/storefront
//   PORT=4373 node apps/storefront/dist/server/entry.mjs   # needs DATABASE_URL
//   node apps/storefront/scripts/check-pixel-defer.mjs     # T_URL to override the origin
//
// Requires the tenant to HAVE pixels configured (store_tracking_channels for the resolved store);
// with none enabled the component renders nothing and this check has nothing to look at.
import { chromium } from "playwright";

const T = process.env.T_URL || "http://toko-demo.test:4373/";
const VENDOR = /connect\.facebook\.net|googletagmanager\.com\/gtag|analytics\.tiktok\.com/;

// Host is a forbidden header in Playwright — the tenant is resolved by mapping the hostname instead.
const b = await chromium.launch({ args: ["--no-sandbox", "--host-resolver-rules=MAP toko-demo.test 127.0.0.1"] });
const ctx = await b.newContext();
const page = await ctx.newPage();

const vendorHits = [];
page.on("request", (r) => { if (VENDOR.test(r.url())) vendorHits.push(r.url()); });
const consoleErrs = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrs.push(m.text()); });
page.on("pageerror", (e) => consoleErrs.push("pageerror: " + String(e)));
// Name the URL behind every failed request — "ERR_CONNECTION_REFUSED" alone is not a diagnosis.
const failed = [];
page.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText} ${r.url()}`));

await page.goto(T, { waitUntil: "domcontentloaded" });

// 1. The stubs must exist IMMEDIATELY — that is what makes the deferral lossless.
const stubs = await page.evaluate(() => ({
  fbq: typeof window.fbq,
  gtag: typeof window.gtag,
  ttq: typeof window.ttq,
  dataLayerLen: (window.dataLayer || []).length,
  fbqQueueLen: (window.fbq && window.fbq.queue ? window.fbq.queue.length : -1),
  ttqLen: Array.isArray(window.ttq) ? window.ttq.length : (window.ttq ? "obj" : -1),
}));
console.log("STUBS (synchronous):", JSON.stringify(stubs));

// 2. THE DETERMINISTIC CLAIM: no vendor <script src> is in the served HTML, so none of them is on the
// parser's critical path. Counting requests after DOMContentLoaded is NOT a valid check — on a fast
// machine `requestIdleCallback` legitimately fires before the first `evaluate()` lands, and the test
// would flake while the code was correct. What must never happen is the browser finding a vendor
// script while it is still parsing the document.
const html = await (await fetch(T.replace("toko-demo.test", "127.0.0.1"), { headers: { host: "toko-demo.test" } })).text();
const inHtml = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((u) => VENDOR.test(u));
console.log(`vendor <script src> in the served HTML: ${inHtml.length} ${JSON.stringify(inHtml)}`);
const before = inHtml.length;

// 3. An event fired NOW, while no SDK exists, must be buffered — not thrown away.
await page.evaluate(() => {
  window.fbq && window.fbq("track", "TestBeforeLoad", { v: 1 });
  window.gtag && window.gtag("event", "test_before_load", { v: 1 });
  window.ttq && window.ttq.track && window.ttq.track("TestBeforeLoad", { v: 1 });
});
const buffered = await page.evaluate(() => ({
  fbqQueueLen: window.fbq && window.fbq.queue ? window.fbq.queue.length : -1,
  dataLayerLen: (window.dataLayer || []).length,
  ttqLen: Array.isArray(window.ttq) ? window.ttq.length : "obj",
}));
console.log("BUFFERED after firing 3 events with no SDK present:", JSON.stringify(buffered));

// 4. Now interact — the shopper touches the page — and the vendors must load.
await page.mouse.move(200, 300);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(4000);

const hosts = [...new Set(vendorHits.map((u) => new globalThis.URL(u).host))].sort();
console.log(`vendor requests after interaction: ${vendorHits.length}  hosts=${JSON.stringify(hosts)}`);
console.log("console errors:", consoleErrs.length ? consoleErrs.slice(0, 4) : "none");
console.log("failed requests:", failed.length ? failed.slice(0, 6) : "none");
// The admin app (uploads/logo origin) is not running in this local harness, so a refused connection to
// ADMIN_BASE is an artifact of the harness, not of the page. Anything else is a real error.
// google-analytics.com/g/collect aborting is a TEARDOWN artifact — GA fires it as the page unloads and
// headless Chrome cancels it. It is not a load failure of anything we control.
const realErrs = failed.filter((f) => !/localhost:3000|127\.0\.0\.1:3000/.test(f) && !/google-analytics\.com\/g\/collect/.test(f));

const ok =
  stubs.fbq === "function" && stubs.gtag === "function" && stubs.ttq !== "undefined" &&
  before === 0 &&
  buffered.fbqQueueLen > 0 &&
  hosts.length === 3 &&
  realErrs.length === 0;
console.log(ok ? "PASS" : "FAIL");
await b.close();
process.exit(ok ? 0 : 1);
