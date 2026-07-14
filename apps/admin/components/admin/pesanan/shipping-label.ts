// Shipping label (resi) — printable, 100×150mm thermal format.
//
// ── About the barcode ────────────────────────────────────────────────────────────────────────
// A previous version of the order page drew "bars" whose widths came from `hash(resi + i) % 3`.
// That is not an encoding of anything: it is noise shaped like a barcode. Printed on a real
// parcel it produces a label a courier's scanner cannot read — the parcel then gets hand-keyed or
// rejected, which is strictly worse than having no barcode at all, because the label LOOKS valid.
//
// This module encodes the AWB as a genuine **Code 128-B** symbol: start-B, the character values,
// the modulo-103 checksum, stop. That is the symbology Indonesian couriers actually use for
// waybills, and it round-trips — the same widths a scanner reads decode back to the exact AWB
// string (verified by decoding the emitted pattern back to text).
//
// It only ever renders a REAL AWB. `buildLabelHtml` refuses to produce a label when
// `orders.awb` is null, so there is no path by which an unscannable or invented number reaches a
// parcel. See lib/actions/shipping.ts for why `awb` is legitimately null right after booking.

/** Code 128 pattern table — index = code value, digits = element widths in modules (bar,space,…). */
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;

/**
 * Encode `text` as Code 128-B and return the element widths, starting with a BAR and alternating
 * bar/space. Returns null when the text contains a character Code 128-B cannot represent
 * (printable ASCII 32..126 only) — we do not silently drop characters out of an AWB.
 */
export function code128b(text: string): number[] | null {
  if (!text) return null;
  const values: number[] = [START_B];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 32 || c > 126) return null;
    values.push(c - 32);
  }
  // checksum: (start + Σ position × value) mod 103, position is 1-based over the data characters
  let sum = START_B;
  for (let i = 1; i < values.length; i++) sum += i * values[i];
  values.push(sum % 103, STOP);

  const widths: number[] = [];
  for (const v of values) for (const d of CODE128_PATTERNS[v]) widths.push(Number(d));
  return widths;
}

/** Render a Code 128-B symbol as inline SVG. Returns "" when the text cannot be encoded. */
export function barcodeSvg(text: string, opts: { height?: number; module?: number } = {}): string {
  const widths = code128b(text);
  if (!widths) return "";
  const mod = opts.module ?? 1.6; // px per module
  const height = opts.height ?? 56;
  const total = widths.reduce((a, w) => a + w, 0) * mod;

  let x = 0;
  let bar = true; // Code 128 always starts on a bar
  const rects: string[] = [];
  for (const w of widths) {
    const px = w * mod;
    if (bar) rects.push(`<rect x="${x.toFixed(2)}" y="0" width="${px.toFixed(2)}" height="${height}" fill="#000"/>`);
    x += px;
    bar = !bar;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total.toFixed(2)}" height="${height}" viewBox="0 0 ${total.toFixed(2)} ${height}" shape-rendering="crispEdges" role="img" aria-label="Barcode Code 128 resi ${text}">${rects.join("")}</svg>`;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

export type LabelInput = {
  /** The REAL courier waybill. Required — there is no label without one. */
  awb: string;
  courier: string;
  orderNumber: string;
  storeName: string;
  senderLine?: string | null;
  recipient: string;
  destination: string;
  recipientPhone?: string | null;
  /** KiriminAja booking reference — printed small, clearly labelled, never as the resi. */
  kaOrderId?: string | null;
  cod: boolean;
  totalLabel: string;
  paymentLabel: string;
  items: { qty: number; title: string; variant?: string | null }[];
  totalQty: number;
  weightLabel?: string | null;
};

/**
 * Build the printable label. Throws when there is no AWB — the caller must not be able to print a
 * parcel label with a number no courier issued.
 */
export function buildLabelHtml(i: LabelInput): string {
  if (!i.awb?.trim()) throw new Error("Tidak ada nomor resi — label tidak bisa dicetak.");
  const awb = i.awb.trim();
  const svg = barcodeSvg(awb);
  // If the AWB somehow isn't Code 128-B encodable we print the number alone and SAY there is no
  // barcode — we never draw decorative bars in its place.
  const barcodeBlock = svg
    ? `<div class="bc">${svg}</div>`
    : `<div class="nobc">Barcode tidak dapat dibuat untuk format resi ini — gunakan nomor resi di bawah.</div>`;

  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Resi ${esc(i.orderNumber)} — ${esc(awb)}</title>
<style>
  @page { size: 100mm 150mm; margin: 0 }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif }
  html, body { margin: 0; background: #fff; color: #000 }
  .label { width: 100mm; height: 150mm; padding: 4mm; border: 1px solid #000; display: flex; flex-direction: column; gap: 1.6mm }
  .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 3mm }
  .courier { font-size: 17pt; font-weight: 800; letter-spacing: -.02em; line-height: 1.1 }
  .svc { font-size: 7.5pt; color: #333 }
  .cod { border: 2px solid #000; padding: 1mm 2mm; font-weight: 800; font-size: 10.5pt; text-align: center; line-height: 1.2 }
  .bc { text-align: center; padding: 1mm 0 0 }
  .bc svg { max-width: 100%; height: 14mm }
  .nobc { border: 1px dashed #000; padding: 1.5mm; font-size: 7.5pt; text-align: center }
  .resi { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13pt; font-weight: 700; letter-spacing: .14em; text-align: center; padding-bottom: 1mm; border-bottom: 1px solid #000 }
  .box { border-top: 1px solid #000; padding-top: 1.4mm }
  .lbl { font-size: 6.5pt; text-transform: uppercase; letter-spacing: .09em; color: #555 }
  .val { font-size: 9pt; font-weight: 600; line-height: 1.3 }
  .items { font-size: 8pt; font-weight: 500; line-height: 1.3 }
  .foot { margin-top: auto; border-top: 1px dashed #000; padding-top: 1.4mm; display: flex; justify-content: space-between; font-size: 7.5pt }
  .ref { font-size: 6.5pt; color: #666 }
  @media screen { body { padding: 16px; background: #e5e5e5 } .label { background: #fff; margin: 0 auto; box-shadow: 0 2px 12px rgba(0,0,0,.2) } }
</style></head><body>
  <div class="label">
    <div class="row">
      <div>
        <div class="courier">${esc(i.courier)}</div>
        <div class="svc">${esc(i.storeName)} · ${esc(i.orderNumber)}</div>
      </div>
      ${
        i.cod
          ? `<div class="cod">COD<br><span style="font-size:9pt">${esc(i.totalLabel)}</span></div>`
          : `<div class="svc" style="text-align:right">NON-COD<br><b>${esc(i.paymentLabel)}</b></div>`
      }
    </div>

    ${barcodeBlock}
    <div class="resi">${esc(awb)}</div>

    <div class="box">
      <div class="lbl">Penerima</div>
      <div class="val">${esc(i.recipient)}<br>${esc(i.destination)}${i.recipientPhone ? `<br>${esc(i.recipientPhone)}` : ""}</div>
    </div>
    <div class="box">
      <div class="lbl">Pengirim</div>
      <div class="val">${esc(i.storeName)}${i.senderLine ? `<br><span style="font-weight:500">${esc(i.senderLine)}</span>` : ""}</div>
    </div>
    <div class="box">
      <div class="lbl">Isi (${i.items.length} item${i.weightLabel ? ` · ${esc(i.weightLabel)}` : ""})</div>
      <div class="items">${i.items
        .map((l) => `${l.qty}× ${esc(l.title)}${l.variant ? ` (${esc(l.variant)})` : ""}`)
        .join(" · ")}</div>
    </div>

    <div class="foot">
      <span>${i.totalQty} pcs</span>
      ${i.kaOrderId ? `<span class="ref">Ref booking: ${esc(i.kaOrderId)}</span>` : "<span></span>"}
      <span>Total ${esc(i.totalLabel)}</span>
    </div>
  </div>
  <script>window.onload=function(){window.print()}</script>
</body></html>`;
}
