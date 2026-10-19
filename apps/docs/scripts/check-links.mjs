// Every internal href (and #anchor) in the BUILT site must resolve to a page and an id on it.
// Usage: node scripts/check-links.mjs [distDir]   (exit 1 on any broken link)
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
const dist = process.argv[2] ?? new URL("../dist", import.meta.url).pathname;
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "pagefind" && f !== "_astro") walk(p); } else if (f.endsWith(".html")) files.push(p); } };
walk(dist);
const ids = new Map();
const pageOf = (url) => { let p = join(dist, url); if (url.endsWith("/")) p = join(p, "index.html"); return p; };
const idsOf = (p) => { if (!ids.has(p)) ids.set(p, new Set([...readFileSync(p, "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))); return ids.get(p); };
const bad = [];
for (const f of files) {
  const html = readFileSync(f, "utf8");
  for (const [, href] of html.matchAll(/\shref="([^"]+)"/g)) {
    if (/^(https?:|mailto:|#$|\/_astro|\/pagefind|data:)/.test(href) || href.endsWith(".svg") || href.endsWith(".webp")) continue;
    const [path, hash] = href.split("#");
    const target = path === "" ? f : pageOf(decodeURI(path));
    if (!existsSync(target)) { bad.push(`${f.slice(dist.length)} → ${href} (no page)`); continue; }
    if (hash && !idsOf(target).has(decodeURIComponent(hash))) bad.push(`${f.slice(dist.length)} → ${href} (no anchor)`);
  }
}
const uniq = [...new Set(bad)];
if (uniq.length) { console.error(uniq.join("\n")); console.error(`check-links: ${uniq.length} broken link(s)`); process.exit(1); }
console.log(`check-links: ok — ${files.length} pages`);
