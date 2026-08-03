// Prove the DEFERRED marketing pixels still track.
//
// `MarketingPixels.astro` keeps every stub/queue/init synchronous but injects the three vendor
// bundles only at idle-or-first-interaction. Measured reason: switching the pixels on took production
// mobile from 90 to 66 and TBT from 130 ms to 770 ms. The risk that buys is that a deferral which
// LOOKS fine can silently drop events — and `astro check`, lint and build all stay green while it
// does. So this is a browser check, not a unit test.
//
// It asserts the four things that make the deferral lossless, FOR EVERY CHANNEL THIS TENANT ENABLED:
//   1. its stub (fbq / gtag / ttq) exists synchronously (a page script may call it at any time)
//   2. NO vendor <script src> is in the served HTML — nothing on the parser's critical path
//   3. events fired while no SDK exists are BUFFERED (queue lengths grow), not thrown away
//   4. after a real interaction that vendor loads
//
// ── ⚠️ WHY THE EXPECTED VENDORS COME FROM THE DATABASE ────────────────────────────────────────────
//
// This check used to hard-code `hosts.length === 3`. The seeded store has exactly ONE channel enabled
// (`store_tracking_channels`: batik-nusantara | meta), so that claim could not hold on the data anyone
// actually runs against — it failed identically on clean `main`, for every change set, forever. Which
// is the failure mode this repo has already paid for: `verify-rls` sat red for weeks, everybody learned
// to scroll past it, and two cross-tenant leaks shipped **past a verifier that was already failing**.
// An alarm that is always on is an alarm that is off.
//
// The fix is not to lower the bar, and it is certainly not to hide the check. It is to assert the claim
// that was always meant: **every channel the merchant switched on is stubbed synchronously, buffers,
// and loads on interaction — and none of them is on the critical path.** So the expected set is read
// from `store_tracking_channels` for the store this host resolves to. That also keeps assertion 1
// honest: derived from the page's own stubs it would be circular ("the stubs that exist, exist").
//
// A tenant with NO channels enabled makes the component render nothing, so there is nothing to look
// at. That exits NOT_APPLICABLE (2) — SKIP, not PASS: a vacuous green is a lie about coverage.
//
// Normally run as part of the suite, which builds and starts the server for you:
//   npm run verify -w @tokophi/storefront
// Standalone, against a storefront you already have running (see check-env.mjs for the contract):
//   DATABASE_URL=… CHECK_BASE_URL=http://toko-demo.test:4390 node apps/storefront/scripts/check-pixel-defer.mjs
import postgres from "postgres";
import { pageUrl, launchChromium, getAsTenant, HOSTNAME, requireDatabaseUrl, NOT_APPLICABLE } from "./check-env.mjs";

const T = pageUrl("/");
const VENDOR = /connect\.facebook\.net|googletagmanager\.com\/gtag|analytics\.tiktok\.com/;

// channel → the host its SDK is fetched from. The stub and the replay buffer for each are sampled in
// the page (`SNAPSHOT` below), keyed by the same channel names, so one row here describes a vendor end
// to end. `ad_channel_key` in Postgres is exactly these three.
const CHANNELS = {
  meta: { host: "connect.facebook.net" },
  google: { host: "www.googletagmanager.com" },
  tiktok: { host: "analytics.tiktok.com" },
};

// Which channels this tenant actually enabled. The storefront resolves the tenant from the Host header
// (ADR 0009); resolve the SAME way, so the check cannot end up describing a different store.
const sql = postgres(requireDatabaseUrl(), { max: 1 });
const rows = await sql`
  select t.channel from store_tracking_channels t
    join store_domains d on d.store_id = t.store_id
   where d.host = ${HOSTNAME} and d.status = 'active'
     and t.enabled and coalesce(t.pixel_id, '') <> ''
   order by t.channel`;
await sql.end();
const enabled = rows.map((r) => r.channel).filter((c) => CHANNELS[c]);
console.log(`channels enabled for ${HOSTNAME}: ${enabled.length ? enabled.join(", ") : "(none)"}`);
if (!enabled.length) {
  console.log(`SKIP  no tracking channel is enabled for ${HOSTNAME} — MarketingPixels renders nothing, so`);
  console.log(`      there is nothing here to prove. Enable a channel on that store to run this check.`);
  process.exit(NOT_APPLICABLE);
}

// Host is a forbidden header in Playwright — the tenant is resolved by mapping the hostname instead.
const b = await launchChromium();
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
// `present` answers "is it callable at all"; `len` is the vendor's own replay buffer, sampled here so
// the buffering claim below can assert that it GREW rather than that it happens to be non-empty.
const SNAPSHOT = () => ({
  present: { meta: typeof window.fbq, google: typeof window.gtag, tiktok: typeof window.ttq },
  len: {
    meta: window.fbq && window.fbq.queue ? window.fbq.queue.length : -1,
    google: (window.dataLayer || []).length,
    tiktok: Array.isArray(window.ttq) ? window.ttq.length : -1,
  },
});
const stubs = await page.evaluate(SNAPSHOT);
console.log("STUBS (synchronous):", JSON.stringify(stubs));

// 2. THE DETERMINISTIC CLAIM: no vendor <script src> is in the served HTML, so none of them is on the
// parser's critical path. Counting requests after DOMContentLoaded is NOT a valid check — on a fast
// machine `requestIdleCallback` legitimately fires before the first `evaluate()` lands, and the test
// would flake while the code was correct. What must never happen is the browser finding a vendor
// script while it is still parsing the document.
// ⚠️ `getAsTenant`, never `fetch` — see the note on it. Fetched with `fetch` this read the 404 page,
// which trivially has no vendor scripts, so this assertion proved nothing for its whole life.
const { status: htmlStatus, body: html } = await getAsTenant("/");
const inHtml = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((u) => VENDOR.test(u));
console.log(`vendor <script src> in the served HTML: ${inHtml.length} ${JSON.stringify(inHtml)}`);
const before = inHtml.length;

// 2b. NO INTERACTION, NO VENDORS. This is the owner decision of 2026-08-01 made testable: the loader
// waits for a real interaction (or a 10 s backstop), so a visitor — or a Lighthouse run — that never
// touches the page must not pay for three third-party bundles. Deterministic now that
// `requestIdleCallback` is gone; it was NOT deterministic before, because idle fires whenever it likes.
await page.waitForTimeout(3000);
const idleHits = vendorHits.length;
console.log(`vendor requests after 3 s with NO interaction: ${idleHits}`);

// 3. An event fired NOW, while no SDK exists, must be buffered — not thrown away.
await page.evaluate(() => {
  window.fbq && window.fbq("track", "TestBeforeLoad", { v: 1 });
  window.gtag && window.gtag("event", "test_before_load", { v: 1 });
  window.ttq && window.ttq.track && window.ttq.track("TestBeforeLoad", { v: 1 });
});
const buffered = await page.evaluate(SNAPSHOT);
console.log("BUFFERED after firing 3 events with no SDK present:", JSON.stringify(buffered.len));

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

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Per ENABLED channel. `ttq` is an array, the other two are functions — "not undefined" is the claim
// they share, and it is the one that matters: a page script may call any of them at any moment.
const missingStub = enabled.filter((c) => stubs.present[c] === "undefined");
check(`every enabled channel is stubbed synchronously`, missingStub.length === 0, missingStub.join(", "));

const notBuffered = enabled.filter((c) => !(buffered.len[c] > stubs.len[c]));
check(
  `an event fired with no SDK present is BUFFERED, not dropped`,
  notBuffered.length === 0,
  notBuffered.map((c) => `${c}: ${stubs.len[c]} → ${buffered.len[c]}`).join(", "),
);

// The status is asserted because the claim below is about what a page CONTAINS: a 404 contains no
// vendor script either, and that is the shape the old `fetch` version silently degraded into.
check(`the tenant page is really being served (Host ${HOSTNAME})`, htmlStatus === 200, `HTTP ${htmlStatus}`);
check(`no vendor <script src> in the served HTML (nothing on the parser's critical path)`, before === 0, inHtml.join(", "));
check(`no vendor request without an interaction (the 10 s backstop has not fired yet)`, idleHits === 0, `${idleHits} request(s)`);

const didNotLoad = enabled.filter((c) => !hosts.includes(CHANNELS[c].host));
check(`every enabled channel's SDK loads after a real interaction`, didNotLoad.length === 0, didNotLoad.join(", "));

// A host we did NOT expect means a vendor is being loaded for a channel the merchant has switched off.
const unexpected = hosts.filter((h) => !enabled.some((c) => CHANNELS[c].host === h));
check(`no SDK loads for a channel that is switched off`, unexpected.length === 0, unexpected.join(", "));

// SCRIPT errors only. A "Failed to load resource" console line is the echo of a request failure, and
// `realErrs` below is the half that can tell OUR failures from the harness's (the admin app, which
// serves the store logo, is not running locally) — the console line carries no URL, so asserting on it
// too would be an alarm nobody could ever silence except by ignoring it.
const thrown = consoleErrs.filter((e) => !/^Failed to load resource/.test(e));
check(`nothing threw in the page`, thrown.length === 0, thrown.slice(0, 2).join(" | "));
check(`no failed requests we own`, realErrs.length === 0, realErrs.slice(0, 3).join(" | "));

console.log(failures === 0 ? "PASS" : "FAIL");
await b.close();
process.exit(failures === 0 ? 0 : 1);
