// Staleness guard (spec §10, decision D6): every `routes:` entry in an article's frontmatter must be a
// Seller route in specs/docs/page-map.json. A renamed or deleted Seller screen fails its article.
// Usage: node scripts/check-routes.mjs   (exit 1 on any unknown route)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const map = JSON.parse(readFileSync(join(root, "../../specs/docs/page-map.json"), "utf8"));
const seller = map.surfaces.find((s) => s.app === "apps/admin");
const known = new Set(seller.routes.map((r) => r.url));

const errors = [];
let checked = 0;
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.mdx?$/.test(f)) continue;
    const fm = readFileSync(p, "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const line = fm.match(/^routes:\s*(\[.*\])\s*$/m)?.[1];
    if (!line) continue;
    for (const route of JSON.parse(line)) {
      checked++;
      if (!known.has(route)) errors.push(`${p.slice(root.length)}: route ${route} is not in page-map.json (Seller)`);
    }
  }
};
walk(join(root, "src/content/docs"));
if (errors.length) { console.error(errors.join("\n")); console.error(`check-routes: ${errors.length} unknown route(s)`); process.exit(1); }
console.log(`check-routes: ok — ${checked} routes`);
