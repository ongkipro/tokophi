// Prove the ⌘K search palette does not hand the browser full-size originals for 42px thumbnails.
//
// ── WHY THIS IS A SEPARATE FILE, AND NOT A FEW LINES IN check-pdp-srcset.mjs ──────────────────────
//
// Two reasons, and the second is the one that decided it.
//
//  1. SCOPE. The palette is mounted by `Layout.astro`, so it is on EVERY route; the PDP check is
//     deliberately about one page's gallery. Asserting the palette there would make "is the search
//     box cheap" a fact about `/produk/dress-midi-bunga`, which is not where anybody would look for
//     it when it breaks.
//  2. DETERMINISM. That file carries a long, expensive note about a check that failed on 5 of 6 runs
//     against correct code, and the fix was to isolate each element's candidate selection. Opening
//     this palette pins `document.body` to `position:fixed` (the iOS scroll lock), puts a `<dialog>`
//     in the top layer over the whole page, and only then re-measures. Perturbing the layout the PDP
//     check measures, inside the check whose flakiness the repo has already paid to remove once, is
//     how you get it back. This one takes the same probe technique and none of its blast radius.
//
// ── WHAT IT ASSERTS, AND WHY IT COULD NOT BE STATIC ──────────────────────────────────────────────
//
// The palette's rows are built by CONCATENATING AN HTML STRING IN JS and assigning `innerHTML`
// (SearchPalette.astro). So the `<img>` exists in no `.astro` template, in no built HTML file, and on
// no page the browser has not been INTERACTED with — `check-pdp-srcset.mjs` sweeps every `<img>` on a
// loaded PDP and cannot see this one, because until something presses ⌘K there is nothing to see.
// The palette must be OPENED, and the results must have come back over the network, before the
// element this file is about exists at all.
//
// Measured 2026-08-03, seeded demo store, 6 best-seller rows on an empty query: 91 178 B of
// full-size originals for six 42 × 56 px boxes. The 200w renditions of the same six are 9 956 B.
//
// The resolution is measured on a SECOND, ISOLATED selection for the reason spelled out at length in
// `check-pdp-srcset.mjs`: the homepage behind the palette renders the SAME products, so a candidate
// the grid has already fetched may legally satisfy a palette row without a second request, and
// `currentSrc` would then report the grid's wider file. Every candidate is rewritten to a URL unique
// to its own `<img>`, and the browser chooses again against the real layout, `sizes` and DPR.
//
// ── ⚠️ IT SHIPPED OUTSIDE THE RUNNER, AND THAT MADE A DOC FALSE ──────────────────────────────────
//
// This file was added in the same wave that CONVERGED every other check onto `check-env.mjs`, and it
// was left out of `run-checks.mjs`'s `CHECKS` array — so `npm run verify` ran five of six and the
// search-palette fix had a guard nobody ran. Worse, it kept its own `T_URL` and `DPR` with a sixth
// default port (4411), which made AGENTS.md's claim that "the old `T_URL` / `H1_PORT` / `DPR` are
// retired and now fail loudly" false for exactly the check the same wave added: the loud failure
// lives in `check-env.mjs`, and a script that does not import it cannot fail loudly. Pointed at it by
// the runner it simply connected to 4411, found nothing, and threw.
//
// Both halves are the same lesson as `verify-rls`: a gate that does not run is not a gate, and a gate
// that is hard to run correctly gets run wrongly.
//
// Normally run as part of the suite, which builds and starts the server for you:
//   npm run verify -w @tokophi/storefront
// Standalone, against a storefront you already have running (see check-env.mjs for the contract):
//   CHECK_BASE_URL=http://toko-demo.test:4390 node apps/storefront/scripts/check-search-srcset.mjs
import { pageUrl, launchChromium } from "./check-env.mjs";

// The palette is mounted by `Layout.astro`, so any route would do; the homepage is the one whose grid
// renders the same products, which is the perturbation the isolated probe below exists to survive.
const T = pageUrl("/");
const DPR = 2; // the ordinary phone, and the case the bug was worst on — a constant, not a knob
const MAX_RATIO = 3; // same generosity as the PDP check: a ladder is discrete and `sizes` errs upward
const PROBE = "__sqprobe";
const CATALOG = "\\/products\\/|\\/api\\/uploads\\/";

const b = await launchChromium();
const page = await b.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: DPR });

const PIXEL = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
await page.route(new RegExp(PROBE), (route) => route.fulfill({ status: 200, contentType: "image/webp", body: PIXEL }));

// Bytes are counted only for what the PALETTE causes — the page behind it is loaded and settled
// first, so whatever the grid fetched is already in cache and out of this number. This one IS the
// point of the exercise, so unlike the PDP check it is reported per-file.
//
// ⚠️ A CACHE HIT IS NOT A DOWNLOAD, and counting it as one flatters the before-number. The homepage
// behind the palette renders the same catalogue, so a row can legitimately be satisfied out of a file
// the grid already has. `serverAddr()` is null exactly when nothing went to the network, so the two
// are reported apart and only the transferred column is a cost.
const paletteBytes = [];
let counting = false;
page.on("response", (r) => {
  if (!counting || r.url().includes(PROBE) || !new RegExp(CATALOG).test(r.url())) return;
  paletteBytes.push(
    r
      .serverAddr()
      .catch(() => null)
      .then((addr) => ({ url: r.url().split("?")[0].split("/").pop(), n: Number(r.headers()["content-length"] || 0), net: !!addr })),
  );
});

await page.goto(T, { waitUntil: "load" });
await page.waitForTimeout(2500); // let the page's own lazy images finish, so they are not counted below

counting = true;
// ⌘K rather than a click on `[data-search-open]`: the header has one trigger per breakpoint and only
// one of them is displayed, so the keyboard path is the one that does not depend on which.
await page.keyboard.press("Control+k");
await page.waitForSelector("#search-palette[open] a[role='option'] img", { timeout: 10_000 });
await page.waitForTimeout(2000); // the rows are lazy; give them time to actually fetch
counting = false;

const imgs = await page.evaluate(
  async ({ PROBE, CATALOG }) => {
    const rx = new RegExp(CATALOG);
    const els = [...document.querySelectorAll("#search-palette a[role='option'] img")];

    const meta = els.map((el, i) => ({
      i,
      catalog: rx.test(el.currentSrc || el.src),
      hasSrcset: !!el.getAttribute("srcset"),
      hasSizes: !!el.getAttribute("sizes"),
      sizes: el.getAttribute("sizes") || "",
      box: Math.round(el.getBoundingClientRect().width),
      // Honest raw width ONLY when there is no srcset — with `w` candidates the spec makes
      // `naturalWidth` density-corrected. That is exactly the no-srcset case this check was born for.
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
        m.cands
          .map((c, k) => `${c.u}${c.u.includes("?") ? "&" : "?"}${PROBE}=${m.i}.${k}${c.w != null ? ` ${c.w}w` : ""}`)
          .join(", "),
      );
    }

    const resolved = (m) => !m.cands.length || (els[m.i].currentSrc.includes(PROBE) && els[m.i].complete);
    for (let t = 0; t < 100 && !meta.every(resolved); t++) await new Promise((r) => setTimeout(r, 100));

    return meta.map((m) => {
      const el = els[m.i];
      const cur = el.currentSrc || el.src;
      const k = (cur.match(new RegExp(`${PROBE}=\\d+\\.(\\d+)`)) || [])[1];
      const picked = k != null ? m.cands[Number(k)] : null;
      return {
        catalog: m.catalog,
        hasSrcset: m.hasSrcset,
        hasSizes: m.hasSizes,
        sizes: m.sizes,
        box: m.box,
        settled: resolved(m),
        src: (picked ? picked.u : cur).split("?")[0].split("/").pop(),
        width: picked ? picked.w : m.natural,
      };
    });
  },
  { PROBE, CATALOG },
);

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

check(`the palette renders product rows with a thumbnail`, imgs.length > 0, `${imgs.length} found`);

// A merchant product with no photo draws an icon, not an <img>, so every <img> here IS a catalog
// image and every one of them must carry both halves of the claim.
const bare = imgs.filter((i) => !i.hasSrcset || !i.hasSizes);
check(
  `every palette thumbnail <img> has srcset + sizes`,
  bare.length === 0,
  `${bare.length} bare: ${bare.map((i) => `${i.src} (${i.width ?? "?"}px file for a ${i.box}px box)`).join(", ")}`,
);

const scored = imgs.map((i) => ({ ...i, ratio: i.box > 0 && i.width ? i.width / (i.box * DPR) : null }));
const oversized = scored.filter((i) => i.ratio !== null && i.ratio > MAX_RATIO);
check(
  `no palette thumbnail exceeds ${MAX_RATIO}x the device pixels it fills (DPR ${DPR})`,
  oversized.length === 0,
  oversized.map((i) => `${i.src} → ${i.width}px for a ${i.box}px box (${i.ratio.toFixed(1)}x)`).join("; "),
);

const unsettled = scored.filter((i) => !i.settled);
check(`every candidate re-resolved (the probe is what makes this deterministic)`, unsettled.length === 0, `${unsettled.length} timed out`);

const rows = await Promise.all(paletteBytes);
const total = rows.filter((r) => r.net).reduce((a, r) => a + r.n, 0);
console.log(`\nopening the palette transferred ${total.toLocaleString()} B in catalog images:`);
for (const r of rows) console.log(`  ${String(r.n).padStart(7)} B  ${r.net ? "network" : "cache  "}  ${r.url}`);
console.log(`\nrows: ${imgs.length}`);
for (const i of scored) {
  console.log(
    `  ${String(i.box).padStart(4)}px box  ${String(i.width ?? "-").padStart(5)}px  ` +
      `${i.ratio ? `${i.ratio.toFixed(2)}x` : "  -  "}  sizes="${i.sizes}"  ${i.src}`,
  );
}

await b.close();
console.log(failures === 0 ? "PASS" : "FAIL");
process.exit(failures === 0 ? 0 : 1);
