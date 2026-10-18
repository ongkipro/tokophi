// UI sweep for the account app (spec §18.6, Task 10.19): every signed-in route, at the widths people
// use, light and dark, against a RUNNING server (a production build: `astro build` + `node
// dist/server/entry.mjs`, or `astro dev`). Fails on: a non-200 page, sideways scroll, a console error,
// a page without exactly one <h1>, a form control without a label, an image without alt — and on the
// one leak that matters most: a second account must get 404 on the first account's order, receipt,
// store profile and affiliate programme.
//
// A production build has no password-less sign-in, so the sweep mints its own sessions: one
// `buyer_sessions` row per account and the same JWT the app signs (`lib/session.ts`), then revokes
// those rows when it ends. It never creates accounts or business rows.
//
//   DATABASE_URL=… AUTH_SECRET=<the server's | dev> node apps/account/scripts/check-ui.mjs \
//     http://localhost:4329 rina@demo.local budi@demo.local
//
// The server and this script must share AUTH_SECRET and point at the same (branch) database.
import { chromium } from "playwright";
import postgres from "postgres";
import { SignJWT } from "jose";

const [ORIGIN = "http://localhost:4329", OWNER = "rina@demo.local", OTHER = "budi@demo.local"] = process.argv.slice(2);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (the server's database).");
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
// Same secret as the server or every page is "signed out". A dev server without AUTH_SECRET signs with
// the public dev literal; pass AUTH_SECRET=dev to say so explicitly — never a silent fallback.
const secret = process.env.AUTH_SECRET === "dev" ? "dev-insecure-secret-change-me" : process.env.AUTH_SECRET;
if (!secret || secret.length < 16) throw new Error("AUTH_SECRET is required (the server's; or AUTH_SECRET=dev for a dev server without one).");
const key = new TextEncoder().encode(secret);

const WIDTHS = [360, 390, 768, 1024, 1440];
const STATIC = [
  "/", "/orders", "/orders?status=selesai", "/orders?status=belum-bayar", "/stores", "/addresses", "/addresses/edit", "/account",
  "/affiliate", "/affiliate/komisi", "/affiliate/program", "/affiliate/gabung",
];
const failures = [];
const fail = (what) => failures.push(what);
const minted = [];

async function cookieFor(email) {
  const [acc] = await sql`select id from buyer_accounts where lower(email) = ${email.toLowerCase()} and status = 'active' limit 1`;
  if (!acc) throw new Error(`No active account for ${email} in this database.`);
  const [s] = await sql`insert into buyer_sessions (buyer_id, user_agent) values (${acc.id}, 'check-ui') returning id`;
  minted.push(s.id);
  const jwt = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(s.id).setAudience("tokophi-account").setIssuedAt().setExpirationTime("1h").sign(key);
  return { name: "tphi_account", value: jwt, url: ORIGIN };
}

async function contextFor(browser, cookie, width, scheme) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: scheme, isMobile: width < 600, hasTouch: width < 600 });
  await ctx.addCookies([cookie]);
  return ctx;
}

/** Links on a page that match a pattern — dynamic routes come from what the owner actually sees. */
async function discover(page, path, pattern) {
  await page.goto(ORIGIN + path);
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  return [...new Set(hrefs.filter((h) => h && pattern.test(h)))];
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const owner = await cookieFor(OWNER);
  const other = await cookieFor(OTHER);

  const probe = await contextFor(browser, owner, 1440, "light");
  const p0 = await probe.newPage();
  const orders = (await discover(p0, "/orders", /^\/orders\/PHI-[^/?#]+$/)).slice(0, 2);
  const stores = (await discover(p0, "/stores", /^\/stores\/[a-z0-9-]+$/)).slice(0, 1);
  const programmes = (await discover(p0, "/affiliate/program", /^\/affiliate\/[0-9a-f-]{36}$/)).slice(0, 1);
  await probe.close();
  if (orders.length === 0) fail(`${OWNER} has no order to sweep — seed the branch DB first`);
  const dynamic = [...orders, ...orders.slice(0, 1).map((o) => `${o}/receipt`), ...stores, ...programmes, ...programmes.map(() => "/affiliate/komisi?state=siap")];
  const routes = [...STATIC, ...dynamic];

  for (const scheme of ["light", "dark"]) {
    for (const width of scheme === "dark" ? [390, 1440] : WIDTHS) {
      const ctx = await contextFor(browser, owner, width, scheme);
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(e.message));
      for (const route of routes) {
        const res = await page.goto(ORIGIN + route);
        const at = `${route} @${width}${scheme === "dark" ? " dark" : ""}`;
        if (res?.status() !== 200) { fail(`${at}: HTTP ${res?.status()}`); continue; }
        const r = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - innerWidth,
          h1: document.querySelectorAll("h1").length,
          unlabeled: [...document.querySelectorAll("input:not([type=hidden]), select, textarea")]
            .filter((el) => !(el.labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby"))).length,
          noAlt: document.querySelectorAll("img:not([alt])").length,
        }));
        if (r.overflow > 0) fail(`${at}: scrolls sideways by ${r.overflow}px`);
        if (r.h1 !== 1) fail(`${at}: ${r.h1} <h1> elements`);
        if (r.unlabeled) fail(`${at}: ${r.unlabeled} form control(s) without a label`);
        if (r.noAlt) fail(`${at}: ${r.noAlt} image(s) without alt`);
        if (errors.length) fail(`${at}: console — ${errors.splice(0).join(" | ")}`);
      }
      await ctx.close();
    }
  }

  // Keyboard: the skip link is the first stop and lands on the content.
  {
    const ctx = await contextFor(browser, owner, 1440, "light");
    const page = await ctx.newPage();
    await page.goto(ORIGIN + "/orders");
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => document.activeElement?.getAttribute("href"));
    if (first !== "#content") fail(`keyboard: first Tab stop is ${first}, expected the skip link`);
    await ctx.close();
  }

  // Tenant negative: the other account sees none of the owner's records.
  {
    const ctx = await contextFor(browser, other, 390, "light");
    const page = await ctx.newPage();
    for (const route of dynamic.filter((r) => !r.includes("?"))) {
      const res = await page.goto(ORIGIN + route);
      if (res?.status() !== 404) fail(`${OTHER} reads ${OWNER}'s ${route}: HTTP ${res?.status()}`);
    }
    await ctx.close();
  }

  console.log(`${routes.length} routes × ${WIDTHS.length + 2} viewports, negative sweep on ${dynamic.filter((r) => !r.includes("?")).length} records`);
} finally {
  await browser.close();
  if (minted.length) await sql`update buyer_sessions set revoked_at = now() where id = any(${minted})`;
  await sql.end();
}

if (failures.length) {
  console.error(`FAIL — ${failures.length} problem(s):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("PASS — account UI sweep");
