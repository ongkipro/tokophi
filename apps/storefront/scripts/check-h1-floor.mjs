// Prove a merchant-built homepage ALWAYS ships exactly one <h1>.
//
// Three failures this guards, all of which leave build, lint and `astro check` green:
//
//   1. ZERO <h1> — `Hero` is the only section in the registry that emits one, so a homepage a
//      merchant assembles out of Grid Produk + Testimoni + FAQ has no top-level heading at all.
//      `index.astro` puts an `sr-only` floor under the template; delete it, or add a new section that
//      is *assumed* to carry the heading, and the page silently loses it again.
//   2. MORE than one <h1> — the hero carousel rendered EVERY slide's headline as an `<h1>`, so a
//      3-slide hero published three. Only `HEADING_INDEX` is a heading now (Hero.astro).
//   3. ZERO <h1> AGAIN, through the gap between the two — a hero whose slides carry an `imageUrl` and
//      NO heading. `heroSlides()` keeps such a slide on purpose (a pictorial hero), so a floor that
//      merely asks "is there a hero section" stands down over a page with no words to head it, and
//      the hero renders `<h1></h1>` — an element with no heading in it. Both halves therefore key on
//      the SAME predicate, "a slide that actually has a heading", and this case is what proves they
//      still agree. Only a rendered page can: the two halves live in different files.
//
// It is an HTTP check, not a unit test, because the bug lives in the SEAM: which section happens to
// render a heading, on a template that lives in the database. Nothing importable holds that answer.
//
// ⚠️ IT WRITES TO THE **SHARED DEV DATABASE** — one `page_templates` row, `is_default`, for a store
// that has no homepage template. Two agents run against this database at the same time, so the write
// is fenced twice:
//
//   1. a SESSION ADVISORY LOCK on a reserved connection. Two runs serialise instead of each staging a
//      default homepage for the same store and then deleting the other's — and Postgres drops a
//      session lock when the connection dies, which `finally` does not survive: a SIGKILL'd run
//      releases it, where a `finally` would simply never have run.
//   2. a sweep of every leftover marker row on the way in. Holding the lock is what makes that safe:
//      nothing else can be mid-run, so any row named `TEMP check-h1-floor` is a corpse. The id is
//      random per run so that even without the lock two runs could not collide on one primary key.
//
// It was previously a FIXED id deleted in `finally`. That self-cleaned in every run anyone observed,
// which is exactly what a latent hazard looks like: a `finally` does not run on SIGKILL, and a stray
// `is_default` homepage template left in a database other people are verifying against is a silent,
// confusing failure for someone else's afternoon, not yours.
//
// Run against a built storefront:
//   npx astro build --root apps/storefront
//   DATABASE_URL=… PORT=4392 node apps/storefront/dist/server/entry.mjs
//   DATABASE_URL=… node apps/storefront/scripts/check-h1-floor.mjs     # H1_PORT to override 4392
import postgres from "postgres";
import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.H1_PORT || 4392);
const TEMP_ID = randomUUID();
const TEMP_NAME = "TEMP check-h1-floor"; // the marker the sweep and the insert agree on
const LOCK_KEY = 528_311_907; // arbitrary, constant, this script's alone
const sql = postgres(process.env.DATABASE_URL, { max: 2 });

/** GET `/` from the storefront as a given tenant. The tenant is the Host header (ADR 0009), and
 *  `fetch` refuses to set it — hence node:http. */
const getHome = (host) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: "/", headers: { Host: host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });

const countH1 = (html) => (html.match(/<h1[\s>]/g) || []).length;
/** The host this store is actually served on: its active primary domain (the subdomain 301s to it). */
const hostOf = (s) => s.primary_host || `${s.slug}.test`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Reserved, because a session-level advisory lock belongs to ONE connection and postgres.js pools:
// taken on a pooled connection it could be released from another, or held by a connection this run
// never uses again.
const lock = await sql.reserve();
await lock`select pg_advisory_lock(${LOCK_KEY})`;

try {
  // Safe only while the lock is held — see the header.
  const swept = await lock`delete from page_templates where name = ${TEMP_NAME} returning id`;
  if (swept.length) console.log(`swept ${swept.length} leftover ${TEMP_NAME} row(s) from a killed run`);

  const stores = await sql`
    select s.id, s.slug, s.name,
           (select d.host from store_domains d
             where d.store_id = s.id and d.status = 'active' and d.is_primary) as primary_host,
           (select pt.sections from page_templates pt
             where pt.store_id = s.id and pt.type = 'homepage' and pt.is_default limit 1) as homepage
      from stores s order by s.slug`;

  // ── 1. A homepage WITH a hero — exactly one, however many slides the carousel holds ──────────────
  const withHero = stores.find(
    (s) => (s.homepage?.content ?? []).some((c) => c.type === "hero"),
  );
  if (!withHero) {
    console.log("SKIP  no store has a hero homepage template — nothing to check");
  } else {
    const slides = withHero.homepage.content.find((c) => c.type === "hero").props?.slides?.length ?? 1;
    const { status, body } = await getHome(hostOf(withHero));
    check(
      `hero homepage (${withHero.slug}, ${slides} slide(s)) has exactly 1 <h1>`,
      status === 200 && countH1(body) === 1,
      `status ${status}, h1 ${countH1(body)}`,
    );
  }

  // ── 2. A homepage template with NO hero — the floor must appear ─────────────────────────────────
  const blank = stores.find((s) => !s.homepage);
  if (!blank) {
    console.log("SKIP  every store already has a homepage template — cannot stage a hero-less one");
  } else {
    const host = hostOf(blank);
    // The heading carries THIS run's id. "the template is live" used to be `body !== before`, which
    // is not the same claim: the catalog is cached per store (data/cache.ts, 15 s), so a run started
    // within 15 s of a previous one saw the PREVIOUS run's staged page as its `before`, staged an
    // identical one, observed no change and reported a failure that was entirely its own echo.
    // Waiting for a marker only this run could have written says what was meant.
    const MARKER = `Cek h1 ${TEMP_ID.slice(0, 8)}`;
    await sql`
      insert into page_templates (id, store_id, type, name, sections, is_default)
      values (${TEMP_ID}::uuid, ${blank.id}::uuid, 'homepage', ${TEMP_NAME},
              ${sql.json({
                content: [
                  {
                    type: "rich-text",
                    props: { id: "t", heading: MARKER, body: "", ctaLabel: "", ctaHref: "", theme: "terang" },
                  },
                ],
              })}, true)
      on conflict (id) do nothing`;

    // Poll for the cache to turn over rather than demand STOREFRONT_CACHE_TTL_MS=0, so the check works
    // against any running server.
    let body = "";
    for (let i = 0; i < 30 && !body.includes(MARKER); i++) {
      await sleep(1000);
      body = (await getHome(host)).body;
    }
    check(`hero-less template (${blank.slug}) is live`, body.includes(MARKER));
    check(`hero-less homepage has exactly 1 <h1>`, countH1(body) === 1, `h1 ${countH1(body)}`);
    check(
      `the floor carries the STORE NAME, never invented copy`,
      body.includes(`<h1 class="sr-only">${blank.name}</h1>`),
    );

    // ── 3. A hero whose slides have an image and NO heading — the gap between the two halves ───────
    //
    // Reuses the SAME staged row (one write, one delete) — only `sections` changes. `imageUrl` is what
    // keeps the slide alive through `heroSlides()`'s `heading || imageUrl` filter, which is precisely
    // the shape that makes this case reachable at all. The marker rides on `subheading`, because a
    // heading is the one field this scenario must leave empty.
    const MARKER2 = `Cek hero-tanpa-judul ${TEMP_ID.slice(0, 8)}`;
    await sql`
      update page_templates set sections = ${sql.json({
        content: [
          {
            type: "hero",
            props: {
              id: "h",
              align: "left",
              badge: "",
              ratingText: "",
              slides: [
                { imageUrl: "/hero/hero-1.webp", heading: "", subheading: MARKER2, ctaLabel: "", ctaHref: "", focal: "center" },
                { imageUrl: "/hero/hero-2.webp", heading: "  ", subheading: "", ctaLabel: "", ctaHref: "", focal: "center" },
              ],
            },
          },
        ],
      })} where id = ${TEMP_ID}::uuid`;

    let body2 = "";
    for (let i = 0; i < 30 && !body2.includes(MARKER2); i++) {
      await sleep(1000);
      body2 = (await getHome(host)).body;
    }
    check(`heading-less hero template (${blank.slug}) is live`, body2.includes(MARKER2));
    check(`a hero with NO slide heading still has exactly 1 <h1>`, countH1(body2) === 1, `h1 ${countH1(body2)}`);
    check(
      `…and it is the FLOOR, not an empty <h1> from the hero`,
      body2.includes(`<h1 class="sr-only">${blank.name}</h1>`),
    );
  }
} finally {
  // The happy path. The lock + sweep above are what covers the unhappy one, where this never runs.
  await sql`delete from page_templates where id = ${TEMP_ID}::uuid`;
  await lock`select pg_advisory_unlock(${LOCK_KEY})`;
  await lock.release();
  await sql.end();
}

console.log(failures === 0 ? "PASS" : "FAIL");
process.exit(failures === 0 ? 0 : 1);
