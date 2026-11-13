/**
 * The Kelola wire format — PURE, no DB, no env.
 *
 * Ported VERBATIM from AdsBookCMS `src/plugins/kelola/sync.ts` @ 1134137 (ADR-028): the payload
 * builders, the signature, the URL rules and the connection-test reading are the same code, so one
 * Kelola workspace receives identical data from both products and a merchant moving between them
 * pastes the same URL + secret (KELOLA_PLUGIN_SPEC.md §4.7). A change to anything here is made in
 * BOTH repositories. Differences from the source, each deliberate:
 *   - `gratisOngkir` is sent when the buyer paid Rp0 shipping. Kelola reads `ongkir: 0` as "Kelola
 *     calculates it" (§1.3), so without the flag a free-shipping order is re-priced by Kelola. Same
 *     defect exists in AdsBookCMS — fix it there too (shared-fix rule).
 *   - `kelurahan` is sent (TokoΦ snapshots it on the order, 0042); Kelola accepts it (§1.3).
 *   - Every POST carries `AbortSignal.timeout(KELOLA_PUSH_TIMEOUT_MS)`, which must stay far below the
 *     5-minute send lease in `sync.ts` — a request that outlived the lease would let a second sender
 *     claim the same order (spec §4.4.1).
 */
import { redactKey } from "@tokophi/lib/redact";

/** Far below the 5-minute claim lease (sync.ts). */
export const KELOLA_PUSH_TIMEOUT_MS = 15_000;

export type KelolaConfig = { url: string; secret: string };

export type KelolaOrderRow = {
  order_number: string;
  created_at: string; // UTC ISO
  customer_name: string;
  customer_phone: string;
  address: string;
  kelurahan?: string | null;
  province: string;
  city: string;
  district: string;
  postal_code: string | null;
  shipping_cost: number;
  discount_amount: number | null;
  total_amount: number;
  payment_method: string;
};
export type KelolaItemRow = { sku: string; name: string; quantity: number; unit_price: number; weight_grams: number };

export type KelolaLeadRow = {
  code: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  province: string;
  city: string;
  district: string;
  total_amount: number;
  source_page_path: string | null;
  product: string | null;
};

/**
 * A pasted webhook URL, or null when it cannot be one Kelola issued. HTTPS only: the body carries
 * buyer names, phones and addresses.
 */
export function normalizeKelolaWebhookUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" && /^\/api\/public\/toko\/order\/[^/]+$/.test(url.pathname) && !url.search
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** The token in a Kelola webhook URL — the part that alone routes to the toko. */
export function kelolaToken(url: string) {
  return url.split("/").pop() ?? "";
}

/** The URL with its token hidden — the token alone routes to the toko. */
export function maskKelolaWebhookUrl(url: string) {
  const token = kelolaToken(url);
  return `${url.slice(0, url.length - token.length)}${token.slice(0, 4)}…${token.slice(-4)}`;
}

/** Kelola's lead webhook sits beside the order one, behind the same token and secret. */
export function kelolaLeadUrl(orderUrl: string) {
  return orderUrl.replace(/\/order\/([^/]+)$/, "/lead/$1");
}

/** Any message that may reach a log, a stored error or a screen: token and secret gone. */
export function redactKelola(message: string, config: KelolaConfig) {
  return redactKey(redactKey(message, kelolaToken(config.url)), config.secret);
}

export async function signKelolaBody(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** One signed POST. The caller owns the response; the timeout is the lease's guard. */
export async function postKelola(url: string, secret: string, body: string, fetcher: typeof fetch) {
  const timestamp = String(Date.now());
  return fetcher(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-timestamp": timestamp,
      "x-signature": await signKelolaBody(secret, timestamp, body),
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(KELOLA_PUSH_TIMEOUT_MS),
  });
}

/**
 * Prove URL + secret without creating an order: a correctly signed empty body passes Kelola's token
 * and signature checks and stops at validation (400).
 */
export async function testKelolaConnection(
  config: KelolaConfig,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await postKelola(config.url, config.secret, "{}", fetcher);
    if (response.status === 400) return { ok: true, message: "Terhubung: URL dan secret diterima Kelola." };
    if (response.status === 404) return { ok: false, message: "Kelola tidak mengenal URL ini. Sambungkan ulang toko di Kelola lalu tempel URL barunya." };
    if (response.status === 401) return { ok: false, message: "Secret tidak cocok dengan URL ini, atau jam server berselisih lebih dari 5 menit." };
    return { ok: false, message: `Kelola membalas HTTP ${response.status}.` };
  } catch (error) {
    return { ok: false, message: redactKelola(`Kelola tidak terjangkau: ${error instanceof Error ? error.message : String(error)}`, config) };
  }
}

/** The body Kelola's `/api/public/toko/order/:token` validates. */
export function kelolaOrderPayload(order: KelolaOrderRow, items: KelolaItemRow[]) {
  const cod = order.payment_method === "cod";
  return {
    code: order.order_number,
    // created_at is UTC ISO; Kelola's order date is the WIB calendar day.
    date: new Date(Date.parse(order.created_at) + 7 * 3_600_000).toISOString().slice(0, 10),
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    address: order.address,
    kelurahan: order.kelurahan || undefined,
    kecamatan: order.district || undefined,
    kota: order.city || undefined,
    provinsi: order.province || undefined,
    kodePos: order.postal_code || undefined,
    payment: cod ? "cod" : "transfer",
    ongkir: order.shipping_cost,
    // Rp0 charged = the store pays shipping; without this Kelola reads 0 as "calculate it".
    gratisOngkir: order.shipping_cost === 0 ? true : undefined,
    discount: order.discount_amount ?? 0,
    // What the courier collects, COD fee included when the buyer bears it.
    codValue: cod ? order.total_amount : null,
    berat: items.reduce((sum, item) => sum + item.weight_grams * item.quantity, 0),
    items: items.map((item) => ({
      sku: item.sku,
      name: item.name,
      qty: item.quantity,
      price: item.unit_price,
    })),
  };
}

/** The body Kelola's `/api/public/toko/lead/:token` validates. */
export function kelolaLeadPayload(lead: KelolaLeadRow) {
  return {
    code: lead.code,
    customerName: lead.customer_name,
    customerPhone: lead.customer_phone,
    address: lead.address || undefined,
    kecamatan: lead.district || undefined,
    kota: lead.city || undefined,
    provinsi: lead.province || undefined,
    produk: lead.product || undefined,
    nilai: lead.total_amount > 0 ? lead.total_amount : undefined,
    halaman: lead.source_page_path || undefined,
  };
}

/**
 * How a push response moves the row (spec §1.5). `synced` = Kelola holds it (201 or `duplikat`);
 * `gave_up` = 400, the payload itself is wrong and a retry repeats it; `broken` = the credential was
 * refused (401/404) — stop the store until it is saved again; `retry` = everything transient.
 */
export type KelolaOutcome = "synced" | "gave_up" | "broken" | "retry";
export function classifyKelolaResponse(status: number): KelolaOutcome {
  if (status >= 200 && status < 300) return "synced";
  if (status === 400) return "gave_up";
  if (status === 401 || status === 404) return "broken";
  return "retry";
}
