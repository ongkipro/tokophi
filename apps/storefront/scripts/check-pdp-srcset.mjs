// Prove the PDP does not hand the browser images grossly larger than the boxes it paints them into.
//
// The third instance of one class. #119 gave the hero a srcset; #120 found the hero's `data-srcset`
// was never promoted onto the IMG; this one found the gallery THUMBNAILS had no `srcset` at all —
// the `<button data-thumb>` carried a full ladder (it swaps the main image on click) while the
// visible `<img>` inside it rendered a bare `src`, so the browser fetched the full-size original into
// a 66px tile. Measured on production: 58 728 B wasted on an upload PDP, 114 073 B on the seeded one.
//
// Every instance was INVISIBLE to `tsc`, ESLint, `astro check` and the build: the markup is valid and
// the page looks perfect. Only what the browser actually RESOLVES shows it, which is why this is a
// browser check and why it asserts on the RESOLVED IMAGE, not on attributes:
//
//   1. structural — every gallery thumbnail <img> carries a non-empty `srcset` AND `sizes`, and no
//                   catalog <img> anywhere on the page is bare (the store logo excepted — see below).
//                   An <img> without them cannot be over-large by accident, and the claim needs no
//                   measurement, which is what lets it cover elements this viewport never paints.
//   2. resolution — no <img> in scope resolves to an image wider than 3x the device pixels it
//                   occupies. Generous on purpose: a ladder is discrete, and `sizes` errs upward so a
//                   thumbnail is never blurry. Pre-fix the thumbnails sat at 4,5–6,1x (verified by
//                   rebuilding the old markup, 2026-08-01); today's worst is 1,52x, so there is real
//                   headroom between "coarse ladder" and "regression".
//
// ── ⚠️ WHY THE RESOLUTION IS NOT READ OFF THE PAGE LOAD ───────────────────────────────────────────
//
// Because `currentSrc` after an ordinary page load is NOT DETERMINISTIC, and asserting on it made
// this check fail on roughly half of all runs against a build that was correct. Measured 2026-08-01,
// six consecutive runs against one unchanged build: PASS FAIL FAIL FAIL FAIL FAIL.
//
// Thumbnail #1 shows `gallery[0]` — the same image as the main product photo, out of the same
// `srcset`. The main photo fills a 380px box and legitimately resolves to the 800w candidate. The
// HTML spec's "select an image source" then PERMITS a user agent to satisfy the 66px thumbnail out of
// that already-available image instead of fetching the 200w file, and Chromium takes it — sometimes,
// depending on whether the wider response has landed before the thumbnail selects. When it does, the
// thumbnail reports 800w for a 66px box: 6,1x, a FAIL — on the run that transferred **1 416 B FEWER**
// than the passing one. The alarm was firing at the cheaper outcome.
//
// That is the failure mode this repo has already paid for once: `verify-rls` sat red for weeks,
// everybody learned to scroll past it, and two cross-tenant leaks shipped **past a verifier that was
// already failing**. An alarm that is always on is an alarm that is off, and a check that cries wolf
// on correct code is on its way to being one within a week.
//
// So the resolution is measured on a SECOND, ISOLATED selection. Every candidate URL is rewritten to
// be unique to its own `<img>` (`?__pdpprobe=<img>.<candidate>`), and the browser re-runs the
// selection against the real layout, the real `sizes` and the real DPR. Nothing is shared, so nothing
// CAN be reused, and the answer is the one the element's own markup entitles it to — which is exactly
// the question this check exists to ask. It still sees everything the old one did: an <img> with no
// srcset still resolves to the original, and a `sizes` that over-claims (the `max-w-[7rem]` cap that
// is really 66px) still makes the browser climb a rung, because the browser, not this script, is
// still the thing doing the choosing.
//
// ⚠️ Do NOT "simplify" the probe away by reading `currentSrc` after `goto`. It is the same number
// only when the cache happens not to interfere, and this file exists because it often does.
//
// ⚠️ And do NOT reach for `naturalWidth` on a srcset image instead: for a `w`-descriptor candidate the
// HTML spec makes `naturalWidth` **density-corrected**, so the 600px file behind `dress-midi-bunga.webp
// 800w` reports **285** at a 380px `sizes` (600 ÷ 800/380), not 600. It is the raw pixel width only
// when there is no srcset — which is exactly where this file uses it.
//
// Normally run as part of the suite, which builds and starts the server for you:
//   npm run verify -w @tokophi/storefront
// Standalone, against a storefront you already have running (see check-env.mjs for the contract):
//   CHECK_BASE_URL=http://toko-demo.test:4390 node apps/storefront/scripts/check-pdp-srcset.mjs
import { pageUrl, launchChromium } from "./check-env.mjs";

// A seeded product with a real gallery. It is a CONSTANT, not an env var: this check exists to police
// one shape of markup, so pointing it at an arbitrary PDP is a debugging session, not a run of the
// gate — and a per-script knob is exactly what check-env.mjs was written to delete.
const T = pageUrl("/produk/dress-midi-bunga");
const DPR = 2; // the ordinary phone, and the case the bug was worst on
const MAX_RATIO = 3;
const PROBE = "__pdpprobe";
const CATALOG = "\\/products\\/|\\/api\\/uploads\\/"; // a string: it is compiled inside the page too

const b = await launchChromium();
const page = await b.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: DPR });

// The probe only needs the browser to COMMIT to a candidate, which it does before the response
// arrives — so the response is a 1×1 stub. No second download, no dependency on the origin still
// being reachable, and no `route.fetch` (which resolves DNS itself and so does not honour the
// `--host-resolver-rules` that makes `toko-demo.test` work at all).
const PIXEL = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
await page.route(new RegExp(PROBE), (route) => route.fulfill({ status: 200, contentType: "image/webp", body: PIXEL }));

// Reported, never asserted: it moves by ~1,4 KB run to run, for the cache reason above.
let bytes = 0;
let counting = true;
page.on("response", (r) => {
  if (counting && new RegExp(CATALOG).test(r.url())) bytes += Number(r.headers()["content-length"] || 0);
});

await page.goto(T, { waitUntil: "load" });
await page.waitForTimeout(2500); // lazy thumbnails + any idle work
counting = false;

const imgs = await page.evaluate(
  async ({ PROBE, CATALOG }) => {
    const rx = new RegExp(CATALOG);
    const els = [...document.querySelectorAll("img")].filter((el) => rx.test(el.currentSrc || el.src));

    // Snapshot each image's own claim BEFORE touching anything. The measured box is what makes this
    // check see through a `max-w-*` cap (5 thumbnails are 66px on a 412px phone, not the 112px the
    // class name says), and `naturalWidth` here is the honest raw width for the no-srcset images —
    // the only ones for which it is not density-corrected.
    const meta = els.map((el, i) => ({
      i,
      thumb: !!el.closest("button[data-thumb]"),
      logo: !!el.closest("[data-logo]"),
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

    // Make every candidate unique to ONE element, then let the browser choose all over again.
    for (const m of meta) {
      if (!m.cands.length) continue;
      els[m.i].setAttribute(
        "srcset",
        m.cands
          .map((c, k) => `${c.u}${c.u.includes("?") ? "&" : "?"}${PROBE}=${m.i}.${k}${c.w != null ? ` ${c.w}w` : ""}`)
          .join(", "),
      );
    }

    // `box === 0` means an ancestor is `display:none` at THIS viewport — the mega menu is `xl:flex`
    // and the mobile drawer is inside an `xl:hidden`, so one of the two is always switched off. Such
    // an <img> is `loading="lazy"` and can never enter the viewport, so the browser never fetches it
    // and never picks a candidate: waiting for one is waiting forever. It has no layout, so there is
    // nothing here to measure and nothing to assert — the structural "has a srcset" claim below is
    // what covers it, which is exactly why that claim is structural. (Before N22 these had no srcset
    // at all and fell out through the `!m.cands.length` arm; giving them one is what surfaced this.)
    const resolved = (m) => !m.cands.length || m.box === 0 || (els[m.i].currentSrc.includes(PROBE) && els[m.i].complete);
    for (let t = 0; t < 100 && !meta.every(resolved); t++) await new Promise((r) => setTimeout(r, 100));

    return meta.map((m) => {
      const el = els[m.i];
      const cur = el.currentSrc || el.src;
      const k = (cur.match(new RegExp(`${PROBE}=\\d+\\.(\\d+)`)) || [])[1];
      const picked = k != null ? m.cands[Number(k)] : null;
      return {
        thumb: m.thumb,
        logo: m.logo,
        hasSrcset: m.hasSrcset,
        hasSizes: m.hasSizes,
        box: m.box,
        settled: resolved(m),
        src: (picked ? picked.u : cur).split("?")[0].split("/").pop(),
        // The width the element committed to on its own: the descriptor of the candidate it picked,
        // or — with no srcset to pick from — the real width of the one file it could have.
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

const thumbs = imgs.filter((i) => i.thumb);
check(`the PDP renders gallery thumbnails`, thumbs.length > 0, `${thumbs.length} found`);
const bare = thumbs.filter((t) => !t.hasSrcset || !t.hasSizes);
check(`every thumbnail <img> has srcset + sizes`, bare.length === 0, `${bare.length} bare: ${bare.map((t) => t.src).join(", ")}`);

const scored = imgs.map((i) => ({ ...i, ratio: i.box > 0 && i.width ? i.width / (i.box * DPR) : null }));

// In scope: the gallery thumbnails, and anything carrying a `srcset` — it made a claim, so a wrong
// claim is a regression. A bare catalog <img> outside the gallery is the NOTE bucket below.
// `width === null` with a srcset means a candidate we cannot size (an `x`-descriptor ladder, which
// nothing here uses); it is printed, not failed, so an unfamiliar-but-correct srcset never invents an
// alarm. A THUMBNAIL with no srcset at all is the original defect and still fails outright.
const inScope = (i) => i.thumb || i.hasSrcset;
const oversized = scored.filter((i) => i.box > 0 && inScope(i) && (i.ratio === null ? !i.hasSrcset : i.ratio > MAX_RATIO));
check(
  `no image exceeds ${MAX_RATIO}x the device pixels it fills (DPR ${DPR})`,
  oversized.length === 0,
  oversized
    .map(
      (i) =>
        `${i.src} → ${i.width ? `${i.width}px${i.hasSrcset ? "" : " (no srcset — the original)"}` : "unsizable"}` +
        ` for a ${i.box}px box${i.ratio ? ` (${i.ratio.toFixed(1)}x)` : ""}`,
    )
    .join("; "),
);

const unsettled = scored.filter((i) => !i.settled);
check(`every candidate re-resolved (the probe is what makes this deterministic)`, unsettled.length === 0, `${unsettled.length} timed out`);

// ── NOW A FAILURE: a catalog <img> with no srcset at all ──────────────────────────────────────────
//
// This section used to PRINT `Header.astro`'s ten bare images without failing, and that was right at
// the time: they are a different file with three separate `sizes` derivations, and a check that is
// red for work nobody in the current change can land is a check everyone learns to ignore — the same
// reason `verify-rls` sat red for weeks while two cross-tenant leaks shipped past it.
//
// They landed (N22), so the note becomes an assertion. A bare catalog `<img>` is never right: with no
// srcset the browser has exactly one file to fetch, the full-size original, whatever box it paints it
// into — measured here at **74 490 B** for five 44 px mega-menu thumbnails and **17 596 B** for the
// drawer's two 184 px tiles, on every page of the shop. And it is invisible to `tsc`, ESLint,
// `astro check` and the build, because the markup is valid and the page looks perfect.
//
// The rule is STRUCTURAL, not ratio-based, and deliberately so: the ratio test below can only see an
// element the browser actually painted, and these render `display:none` at this check's 412 px
// viewport (the mega menu is `xl:flex`) while still costing every desktop visitor the bytes. An
// `<img>` with no srcset cannot be right at any width, so it does not need to be measured to be
// judged.
//
// ⚠️ The store LOGO is exempt, and it is the one honest exception: it is a merchant upload of unknown
// aspect ratio rendered `h-9 w-auto`, so its CSS width is a function of the file's own proportions
// and cannot be derived from the layout the way the other three can. Giving it a `sizes` would mean
// guessing — which is the failure this whole check exists to prevent. Tracked separately.
const noSrcset = scored.filter((i) => !i.hasSrcset && !i.thumb && !i.logo);
check(
  `every catalog <img> carries a srcset (the store logo excepted)`,
  noSrcset.length === 0,
  noSrcset
    .map((i) => `${i.src} → ${i.width ? `${i.width}px file` : "unsized"} for a ${i.box}px box${i.ratio ? ` (${i.ratio.toFixed(1)}x)` : i.box === 0 ? " (not painted at this viewport — still downloaded at others)" : ""}`)
    .join("; "),
);

console.log(`\nimages: ${imgs.length} · catalog bytes on first load: ${bytes.toLocaleString()} B (reported only — see the header)`);
for (const i of scored) {
  console.log(
    `  ${i.thumb ? "thumb" : "     "} ${String(i.box).padStart(4)}px box  ${String(i.width ?? "-").padStart(5)}px  ` +
      `${i.ratio ? `${i.ratio.toFixed(2)}x` : "  -  "}  ${i.src}`,
  );
}

await b.close();
console.log(failures === 0 ? "PASS" : "FAIL");
process.exit(failures === 0 ? 0 : 1);
