// Renders a UAT sheet written in Markdown (specs/docs/uat/*.md) to the PDF KiriminAja's portal
// accepts (≤ 10 MB), with both parties' vector logos in the header and every image inlined.
//
// The Markdown is the tracked source — Markdown does not trigger a Coolify deploy (`!**/*.md`,
// DEPLOY.md), which is why the sheet is no longer kept as HTML. micromark (+ GFM tables) is already
// a transitive dependency and Playwright's Chromium is the repo's browser; nothing is installed.
//
// Run (repo root):  node ops/uat-sheet-render.mjs specs/docs/uat/<sheet>.md ~/Downloads/<sheet>.pdf
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { chromium } from "playwright";

const [, , mdPath, pdfPath] = process.argv;
if (!mdPath || !pdfPath) {
  console.error("usage: node ops/uat-sheet-render.mjs <sheet.md> <out.pdf>");
  process.exit(1);
}
const md = readFileSync(mdPath, "utf8");
const dir = dirname(resolve(mdPath));
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };

let body = micromark(md, { extensions: [gfm()], htmlExtensions: [gfmHtml()], allowDangerousHtml: true });
// Inline every relative image as a data URI — the PDF must be self-contained and the sandbox that
// prints it has no file access.
body = body.replace(/<img src="(?!data:|https?:)([^"]+)"/g, (m, src) => {
  const file = join(dir, decodeURIComponent(src));
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) return m;
  return `<img class="label" src="data:${mime};base64,${readFileSync(file).toString("base64")}"`;
});
// The template's first two lines are the title and subtitle; promote them to the page heading.
body = body.replace(/^<p><strong>(.*?)<\/strong><\/p>\n<p>(.*?)<\/p>/, "<h1>$1</h1><div class=\"small\">$2</div>");
// Section headings are bold paragraphs in the template ("**1\\. Informasi Dokumen**").
body = body.replace(/<p><strong>([^<]*)<\/strong><\/p>/g, "<h2>$1</h2>");
// The first table is the upload-terms box.
body = body.replace(/<table>\s*<thead>\s*<tr>\s*<th align="left">(Ketentuan upload:[^<]*)<\/th>\s*<\/tr>\s*<\/thead>\s*<\/table>/, '<div class="terms">$1</div>');
// Long JSON evidence inside a table cell must wrap, never widen the page.
body = body.replace(/<code>/g, '<code style="white-space:pre-wrap;word-break:break-all;font-size:8pt">');
// Column widths are decided by SHAPE (how many header cells), so the 41%-wide evidence column cannot
// squeeze "Fitur" down to one character per line — measured: 11 pages instead of 5 without this.
body = body.replace(/<table>\s*<thead>\s*<tr>((?:\s*<th[^>]*>[\s\S]*?<\/th>)+)\s*<\/tr>/g, (m, ths) => {
  const n = (ths.match(/<th/g) ?? []).length;
  return m.replace("<table>", `<table class="cols-${n}">`);
});
// One checkbox option per line, so "☑ Pass ☐ Fail ☐ N/A" never wraps mid-word in a narrow column.
body = body.replace(/(☐|☑) (Pass|Fail|N\/A|Diuji|COD|Non-COD|Dashboard KiriminAja|API|Sistem Member)/g, '<span class="opt">$1 $2</span>');

const HEADER = `<div class="hdr"><div class="brand"><svg width="30" height="30" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#4f46e5"/><ellipse cx="16" cy="16" rx="7.2" ry="8.8" fill="none" stroke="#fff" stroke-width="2.6"/><rect x="14.7" y="3.6" width="2.6" height="24.8" rx="1.3" fill="#fff"/></svg><div><div class="wm">Toko<span class="phi">Φ</span></div><div class="sub">Mitra API · Sandbox 5758</div></div></div>
<div class="vendor"><svg width="22" height="22" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_35_12724)">
<path d="M1024 0H0V1024H1024V0Z" fill="url(#paint0_linear_35_12724)" stroke="black" stroke-width="0.94" stroke-miterlimit="10"/>
<path d="M697.877 231.742L617.897 474.722C612.237 494.062 596.217 501.262 585.157 490.982L562.937 469.522L552.457 458.822L494.157 512.662C380.377 636.322 497.037 752.982 497.037 752.982L316.617 572.542C315.997 571.942 315.317 571.422 314.717 570.802C314.217 570.302 313.797 569.742 313.317 569.242L312.077 568.002L312.177 567.962C281.817 534.322 284.397 484.462 316.797 451.922L430.377 336.122L420.577 326.122L398.797 306.542C387.717 296.262 391.817 277.762 406.157 273.222L670.617 213.182C684.957 208.642 698.797 221.482 697.917 231.782L697.877 231.742Z" fill="url(#paint1_linear_35_12724)"/>
<path d="M657.324 675.621C691.604 709.861 691.924 763.061 658.424 796.281C624.924 829.501 572.584 827.881 538.544 793.901L493.21 748.831C474.007 727.034 392.988 622.616 494.156 512.662L494.165 512.654L657.324 675.621ZM313.316 569.242C313.796 569.742 314.217 570.302 314.717 570.802C315.317 571.422 315.996 571.942 316.616 572.542L438.596 694.535L318.685 575.321C316.338 573.001 314.147 570.569 312.114 568.04L313.316 569.242ZM311.051 566.688C311.421 567.115 311.796 567.54 312.177 567.962L312.081 567.999C311.733 567.565 311.39 567.128 311.051 566.688Z" fill="url(#paint2_linear_35_12724)"/>
</g>
<defs>
<linearGradient id="paint0_linear_35_12724" x1="512" y1="0" x2="512" y2="1024" gradientUnits="userSpaceOnUse">
<stop stop-color="#FF1DBE"/>
<stop offset="0.13" stop-color="#DF1DBD"/>
<stop offset="0.3" stop-color="#BB1EBC"/>
<stop offset="0.48" stop-color="#9F1EBB"/>
<stop offset="0.65" stop-color="#8B1EBB"/>
<stop offset="0.83" stop-color="#7F1EBB"/>
<stop offset="1" stop-color="#7B1FBB"/>
</linearGradient>
<linearGradient id="paint1_linear_35_12724" x1="782.641" y1="341.937" x2="237.393" y2="623.466" gradientUnits="userSpaceOnUse">
<stop stop-color="white"/>
<stop offset="0.99" stop-color="#F1F1F1" stop-opacity="0.5"/>
</linearGradient>
<linearGradient id="paint2_linear_35_12724" x1="292.569" y1="624.254" x2="682.943" y2="623.982" gradientUnits="userSpaceOnUse">
<stop stop-color="white" stop-opacity="0.1"/>
<stop offset="1" stop-color="#F1F1F1" stop-opacity="0.8"/>
</linearGradient>
<clipPath id="clip0_35_12724">
<rect width="1024" height="1024" rx="250" fill="white"/>
</clipPath>
</defs>
</svg>
<div><div style="font-weight:700">KiriminAja</div><div class="small">User Acceptance Test — MitraAPI V1</div></div></div></div>`;
const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>UAT — MitraAPI · TokoΦ × KiriminAja</title><style>
@page { size: A4; margin: 14mm 13mm 16mm 13mm; }
* { box-sizing: border-box }
body { font-family: "Geist", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color:#111; font-size:9.6pt; line-height:1.38; margin:0 }
.hdr { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #111; padding-bottom:8px; margin-bottom:10px }
.brand { display:flex; align-items:center; gap:10px }
.wm { font-weight:700; font-size:20pt; letter-spacing:-0.02em; line-height:1.15 }
.wm .phi { color:#4f46e5 }
.sub { font-size:8.5pt; color:#555; letter-spacing:.12em; text-transform:uppercase; font-family: ui-monospace, Menlo, monospace }
.vendor { display:flex; align-items:center; gap:8px; font-size:9pt; color:#333 }
h1 { font-size:17pt; margin:6px 0 0; letter-spacing:-0.02em }
h2 { font-size:11.5pt; margin:16px 0 6px; padding-top:6px; border-top:1px solid #ddd }
.terms { border:1px solid #bbb; background:#f7f7f7; padding:6px 8px; font-size:8.6pt; margin:8px 0 2px }
table { width:100%; border-collapse:collapse; margin:4px 0 6px; page-break-inside:auto }
tr { page-break-inside:avoid }
th, td { border:1px solid #999; padding:4px 5px; vertical-align:top; text-align:left }
th { background:#efefef; font-weight:700; font-size:9pt }
td.k { width:34%; font-weight:600; background:#fafafa }
td.n { width:5%; text-align:center; font-variant-numeric:tabular-nums }
td.st, .st { white-space:nowrap }
.small { font-size:8.4pt; color:#444 }
img.label { width:56mm; border:1px solid #ccc; display:block }
.foot { margin-top:10px; border-top:1px solid #ddd; padding-top:5px; font-size:7.8pt; color:#555; page-break-inside:avoid }
.pb { page-break-before: always }

table { table-layout: fixed }
td, th { overflow-wrap: anywhere }
.opt { display: block; white-space: nowrap }
.cols-2 th:first-child, .cols-2 td:first-child { width: 26% }
.cols-3 th:nth-child(1), .cols-3 td:nth-child(1) { width: 24% }
.cols-3 th:nth-child(2), .cols-3 td:nth-child(2) { width: 16% }
.cols-7 th:nth-child(1), .cols-7 td:nth-child(1) { width: 4%; text-align: center }
.cols-7 th:nth-child(2), .cols-7 td:nth-child(2) { width: 11% }
.cols-7 th:nth-child(3), .cols-7 td:nth-child(3) { width: 15% }
.cols-7 th:nth-child(4), .cols-7 td:nth-child(4) { width: 11% }
.cols-7 th:nth-child(5), .cols-7 td:nth-child(5) { width: 40% }
.cols-7 th:nth-child(6), .cols-7 td:nth-child(6) { width: 10%; font-size: 8.2pt }
.cols-7 th:nth-child(7), .cols-7 td:nth-child(7) { width: 9% }
.cols-7 td { font-size: 8.6pt }
img.label { max-width: 56mm }
h1 { margin-top: 0 }
</style></head><body>${HEADER}${body}</body></html>`;
const htmlPath = pdfPath.replace(/\.pdf$/i, ".html");
writeFileSync(htmlPath, html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.pdf({ path: pdfPath, format: "A4", printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log(`wrote ${pdfPath} (+ ${htmlPath})`);
