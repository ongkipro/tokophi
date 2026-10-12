// Owner SEO invariants (preferences.md, 2026-09-30 / 2026-10-01), checked against the BUILT site:
//   <title> 55–70 chars, "{page} - {brand}" (no "|" or "—"); meta description 120–155 chars ending
//   with "."; meta author + publisher present; every content <img> is WebP with an ALT of 10–125 chars.
// Usage: node scripts/check-seo.mjs [distDir]   (exit 1 on any violation)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? new URL("../dist", import.meta.url).pathname;
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== "pagefind" && f !== "_astro") walk(p); }
    else if (f.endsWith(".html")) files.push(p);
  }
};
walk(dist);

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const len = (s) => [...s].length;
const errors = [];
let pages = 0, imgs = 0;
for (const f of files) {
  const html = readFileSync(f, "utf8");
  const rel = f.slice(dist.length);
  if (/name="robots" content="[^"]*noindex/.test(html) || rel === "/404.html") continue;
  pages++;
  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
  if (len(title) < 55 || len(title) > 70) errors.push(`${rel}: title ${len(title)} chars "${title}"`);
  if (/[|—]/.test(title)) errors.push(`${rel}: title uses "|" or "—"`);
  const desc = decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "");
  if (len(desc) < 120 || len(desc) > 155) errors.push(`${rel}: description ${len(desc)} chars`);
  if (!desc.endsWith(".")) errors.push(`${rel}: description does not end with "."`);
  for (const n of ["author", "publisher"]) if (!new RegExp(`<meta name="${n}" content="[^"]+"`).test(html)) errors.push(`${rel}: missing meta ${n}`);
  const main = html.slice(html.indexOf("<main"), html.lastIndexOf("</main>"));
  for (const tag of main.match(/<img\b[^>]*>/g) ?? []) {
    imgs++;
    const src = tag.match(/\ssrc="([^"]+)"/)?.[1] ?? "";
    const alt = decode(tag.match(/\salt="([^"]*)"/)?.[1] ?? "");
    if (!/\.webp(\?|$)/.test(src) && !src.endsWith(".svg")) errors.push(`${rel}: non-WebP image ${src}`);
    if (len(alt) < 10 || len(alt) > 125) errors.push(`${rel}: ALT ${len(alt)} chars on ${src}`);
  }
}
if (errors.length) { console.error(errors.join("\n")); console.error(`check-seo: ${errors.length} violation(s)`); process.exit(1); }
console.log(`check-seo: ok — ${pages} pages, ${imgs} images`);
