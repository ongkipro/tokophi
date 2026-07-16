// Responsive guard for the Seller dashboard — the admin twin of the storefront's audit
// (apps/storefront/scripts/audit-responsive.mjs), same rule and same reasoning.
//
// Horizontal overflow is the one symptom that reliably means "the layout broke". It is invisible in a
// screenshot taken at one width, and it is exactly what a merchant feels on a phone: the page drifts
// sideways, the Simpan button hides off-screen, pinch-zoom fights back. The admin is FULL of the
// things that cause it — data tables, KPI rows, charts, toolbars — and unlike the storefront nobody
// browses it on a phone until they have to. So it gets checked mechanically.
//
// Needs a session: every admin route is behind auth, so we log in first and reuse the cookie. Routes
// live under /store/<slug>/… — the slug is read from the post-login redirect, never hardcoded.
//
//   npm run audit:responsive -w @tokophi/admin                       # against prod
//   npm run audit:responsive -w @tokophi/admin http://localhost:3000 # against a dev server
//
// Exits non-zero on a break, so it can gate a release.
import { createRequire } from "module";
const require = createRequire(new URL("../../../", import.meta.url));
const { chromium } = require("playwright");

const BASE = (process.argv[2] ?? "https://app.tokophi.com").replace(/\/$/, "");
const EMAIL = process.env.AUDIT_EMAIL ?? "ongki@batiknusantara.id";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "tokophi123";

// Real devices, not the breakpoints we happened to pick:
// 320 = smallest phone still in use · 360 = the most common Android · 390/414 = modern iPhone
// 600 = phablet / split view · 768 = iPad portrait · 820/1024 = iPad landscape · 1280–1920 = desktop
const WIDTHS = [320, 360, 390, 414, 600, 768, 820, 1024, 1280, 1440, 1920];

// Store-scoped screens (prefixed with /store/<slug> at runtime) + account screens that are not.
const STORE_ROUTES = [
  "", "/pesanan", "/produk", "/produk/kategori", "/produk/inventori", "/produk/pembelian",
  "/pelanggan", "/pelanggan/segmen", "/pelanggan/ulasan", "/crm", "/diskon", "/analitik",
  "/pemasaran", "/halaman", "/blog", "/navigasi", "/tema", "/saldo", "/obrolan", "/bantuan",
  "/pengaturan",
];
const FLAT_ROUTES = ["/akun/profil", "/akun/keamanan", "/akun/langganan"];

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60_000 });
await page.fill('input[type="email"], input[name="email"]', EMAIL);
await page.fill('input[type="password"], input[name="password"]', PASSWORD);
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle", timeout: 60_000 }).catch(() => {}),
  page.click('button[type="submit"]'),
]);
const landed = page.url();
const m = landed.match(/\/store\/([^/?#]+)/);
if (!m) {
  console.error(`Login did not land on /store/<slug> (got ${landed}). Wrong credentials?`);
  await browser.close();
  process.exit(1);
}
const prefix = `/store/${m[1]}`;
const ROUTES = [...STORE_ROUTES.map((r) => prefix + r), ...FLAT_ROUTES];

let broken = 0;
for (const route of ROUTES) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(250);

    const result = await page.evaluate((vw) => {
      const overflow = document.documentElement.scrollWidth - vw;
      if (overflow <= 1) return { overflow, culprits: [] };

      // Ignore two kinds of "overflow" that are working as designed and never reach the document:
      //   · position:fixed subtrees — the mobile sidebar is parked off-screen.
      //   · anything inside a horizontal SCROLL container — a wide data table is SUPPOSED to run
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
        culprits.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls} [w=${Math.round(box.width)}]`);
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
