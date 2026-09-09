import "server-only";
import { AUTOLARIS_RC_OK, isConfigured } from "./integration-status";
import { PAYMENT_FEES, channelFeeValue, type FeeKind } from "./payment-fees";

// AutoLaris payment-gateway client (platform-managed PSP). Create Payment → VA / QRIS / DANA.
// Base + Bearer key from env (gitignored). Verified against ongkipro/autolaris-payment-gateway docs.
const BASE = process.env.AUTOLARIS_BASE ?? "https://api-h2h.autolaris.com";
const KEY = process.env.AUTOLARIS_API_KEY ?? "";

export const autolarisConfigured = () => isConfigured(KEY);

// channel_code → client-facing label (NO provider brand shown to merchants/shoppers).
// Only channels ACTIVE on the platform account are listed — verified live against the gateway
// (create_payment rc=00). All active channels return inline instructions (VA no. / QRIS payload),
// url="" → shopper NEVER leaves our success page. Re-add BSI/DANA here once enabled on the account.
export const PAYMENT_CHANNELS: { code: string; label: string; kind: "va" | "qris" | "ewallet" }[] = [
  { code: "QRIS", label: "QRIS", kind: "qris" },
  { code: "VABCA", label: "Virtual Account BCA", kind: "va" },
  { code: "VAMANDIRI", label: "Virtual Account Mandiri", kind: "va" },
  { code: "VABNI", label: "Virtual Account BNI", kind: "va" },
  { code: "VABRI", label: "Virtual Account BRI", kind: "va" },
  { code: "VAPERMATA", label: "Virtual Account Permata", kind: "va" },
];
export const channelLabel = (code: string) => PAYMENT_CHANNELS.find((c) => c.code === code)?.label ?? code;

// Display metadata for a channel code: our own Indonesian label + the `kind` our fee schedule and
// the settings UI group by. ⚠️ THIS IS A LOOKUP TABLE, NOT A SOURCE OF TRUTH. Which channels the
// platform's AutoLaris account actually has is answered by `GET /api/h2h/list_payment` (see
// `alListPayment` below); a code that is absent from that response is not available, however it is
// labelled here. A code the provider returns that is NOT in this table still renders — under the
// provider's own `name` — because a hardcoded roster must never be able to hide a real channel.
export const AUTOLARIS_KNOWN_CHANNELS: { code: string; label: string; kind: "va" | "qris" | "ewallet" | "retail" }[] = [
  { code: "QRIS", label: "QRIS", kind: "qris" },
  { code: "VABCA", label: "Virtual Account BCA", kind: "va" },
  { code: "VAMANDIRI", label: "Virtual Account Mandiri", kind: "va" },
  { code: "VABNI", label: "Virtual Account BNI", kind: "va" },
  { code: "VABRI", label: "Virtual Account BRI", kind: "va" },
  { code: "VABSI", label: "Virtual Account BSI", kind: "va" },
  { code: "VAPERMATA", label: "Virtual Account Permata", kind: "va" },
  { code: "VACIMB", label: "Virtual Account CIMB", kind: "va" },
  { code: "VADANAMON", label: "Virtual Account Danamon", kind: "va" },
  { code: "DANA", label: "DANA", kind: "ewallet" },
  { code: "OVO", label: "OVO", kind: "ewallet" },
  { code: "SHOPEEPAY", label: "ShopeePay", kind: "ewallet" },
  { code: "LINKAJA", label: "LinkAja", kind: "ewallet" },
  { code: "GOPAY", label: "GoPay", kind: "ewallet" },
  { code: "ALFAMART", label: "Alfamart", kind: "retail" },
  { code: "INDOMARET", label: "Indomaret", kind: "retail" },
];

// ── GET /api/h2h/list_payment — THE authoritative channel + account fee list ────────────────────
//
// 🔴 WHAT THIS REPLACED, AND WHY IT MATTERS: `alProbeChannels` used to discover the account's
// channels by looping `AUTOLARIS_KNOWN_CHANNELS` and firing ONE REAL `POST /api/h2h/create_payment`
// per code — 16 live provider calls per Sync, each one CREATING AN ACTUAL BILL on the platform's
// AutoLaris account (its own comment admitted "EXPENSIVE … creates sandbox bills"), all of them
// abandoned, to learn something a single GET returns. It was also WRONG about the answer: measured
// 2026-09-09, `list_payment` reports OVO as available on this account while the rc-probe had left
// `platform_payment_channels.OVO` at `active = false`. The vendor documents this endpoint as
// "Channel aktif dan konfigurasi fee akun" and its own go-live checklist says the UI must take
// channels from here, not from a hardcoded list. Never reintroduce a create_payment probe.
//
// ⚠️ ABSENCE IS THE ONLY "disabled" SIGNAL THE RESPONSE CARRIES. There is no `active`/`enabled`
// field on a row (verified live 2026-09-09 and against the vendor OpenAPI snapshot, whose row
// requires exactly `channel_code`, `name`, `admin`, `tipe_admin`). A channel is available iff the
// provider lists it. Do not invent a status field.
export type AlFeeType = "flat" | "pct" | "unknown";
export type AlChannelConfig = {
  code: string;
  /** the provider's own display name, e.g. "Bank BCA" — used only when we have no label of our own */
  providerName: string;
  feeType: AlFeeType;
  /**
   * `flat` → IDR per transaction. `pct` → a FRACTION, not a percentage: the provider sends
   * `tipe_admin: "persen"`, `admin: "0.7"` meaning 0,7%, and this field carries `0.007` so it is
   * directly comparable with `PAYMENT_FEES.qris.value`. `unknown` → null; a fee we cannot read is
   * never guessed at as 0, because 0 is a legitimate value (COD comes back `"0.0"`/`fix`).
   */
  feeValue: number | null;
  /** exactly what the provider sent, so an operator can see the unparsed truth */
  rawAdmin: string;
  rawTipeAdmin: string;
};
export type AlListPayment = { ok: boolean; channels: AlChannelConfig[]; error?: string };

/**
 * PURE parser for a `list_payment` response — no network, no env, so the shape rules are testable.
 * Everything a malformed row can do is drop that row; a bad envelope drops the whole answer, and an
 * empty `channels` on `ok:false` is what stops a caller writing "nothing is active" into the DB.
 */
export function parseListPayment(json: unknown): AlListPayment {
  const env = json as { rc?: unknown; ket?: unknown; data?: unknown } | null;
  if (!env || typeof env !== "object") return { ok: false, channels: [], error: "Respons tidak dikenali." };
  // rc is checked BEFORE `data` is consumed — the provider ships an envelope, not an HTTP status.
  if (env.rc !== AUTOLARIS_RC_OK) {
    const ket = typeof env.ket === "string" && env.ket.trim() ? env.ket.trim() : undefined;
    return { ok: false, channels: [], error: ket ?? `Gagal (rc=${String(env.rc ?? "?")})` };
  }
  if (!Array.isArray(env.data)) return { ok: false, channels: [], error: "Daftar channel kosong / tidak valid." };
  const channels: AlChannelConfig[] = [];
  for (const row of env.data as unknown[]) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const code = typeof r.channel_code === "string" ? r.channel_code.trim().toUpperCase() : "";
    if (!code) continue; // a row with no channel_code identifies nothing and cannot be rendered
    const rawAdmin = typeof r.admin === "string" ? r.admin : typeof r.admin === "number" ? String(r.admin) : "";
    const rawTipeAdmin = typeof r.tipe_admin === "string" ? r.tipe_admin.trim().toLowerCase() : "";
    const n = Number(rawAdmin);
    const numeric = rawAdmin.trim() !== "" && Number.isFinite(n);
    let feeType: AlFeeType = "unknown";
    let feeValue: number | null = null;
    if (numeric && rawTipeAdmin === "fix") { feeType = "flat"; feeValue = n; }
    // Rounded to 9 dp: "0.7" / 100 is 0.006999999999999999 in IEEE-754, which is not the number
    // `PAYMENT_FEES.qris.value` holds. Comparison already uses an epsilon, but an operator reading
    // "0,6999999999%" off the settings table would reasonably think the provider had moved.
    else if (numeric && rawTipeAdmin === "persen") { feeType = "pct"; feeValue = Math.round((n / 100) * 1e9) / 1e9; }
    channels.push({
      code,
      providerName: typeof r.name === "string" && r.name.trim() ? r.name.trim() : code,
      feeType, feeValue, rawAdmin, rawTipeAdmin,
    });
  }
  return { ok: true, channels };
}

/**
 * Read the account's channel + fee configuration. Creates NOTHING — a plain GET, safe to call from
 * an operator screen and safe to call against production.
 *
 * Provider error text: this returns the vendor's `ket` verbatim, the same choice `alCreatePayment`
 * and `alInquirePaymentStatus` already make in this file. That is safe HERE because the only caller
 * is the Super Admin settings screen — an OPERATOR surface, where "Unauthorized." or "IP not
 * whitelisted" is precisely the sentence that tells them what to fix. The shopper-facing
 * substitution rule (`PAY_START_FAILED` in `api/public/order`) is unchanged and unaffected: no
 * public route reaches this function.
 */
export async function alListPayment(): Promise<AlListPayment> {
  if (!KEY) return { ok: false, channels: [], error: "API key belum diisi (AUTOLARIS_API_KEY)." };
  try {
    const res = await fetch(`${BASE}/api/h2h/list_payment`, {
      method: "GET",
      headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
      cache: "no-store",
    });
    return parseListPayment(await res.json());
  } catch (e) {
    return { ok: false, channels: [], error: e instanceof Error ? e.message : "Gagal terhubung." };
  }
}

export type AlChannelProbe = { code: string; label: string; kind: string; active: boolean; fee: AlChannelConfig | null };
export type AlProbeResult = { ok: boolean; error?: string; channels: AlChannelProbe[] };

/**
 * PURE merge of a `list_payment` answer with our display table. Every code the provider returned is
 * active (see the "absence is the only disabled signal" note above); every code we know a label for
 * but the provider did NOT return is reported inactive so the settings screen can grey it out.
 */
export function mergeChannelProbe(list: AlListPayment): AlProbeResult {
  if (!list.ok) return { ok: false, error: list.error, channels: [] };
  const meta = new Map(AUTOLARIS_KNOWN_CHANNELS.map((c) => [c.code, c]));
  const seen = new Set<string>();
  const channels: AlChannelProbe[] = [];
  for (const c of list.channels) {
    seen.add(c.code);
    const m = meta.get(c.code);
    // A code with no entry in our table still shows, under the PROVIDER's name and with an empty
    // `kind`. Dropping it would let a stale hardcoded list hide a channel the account really has.
    channels.push({ code: c.code, label: m?.label ?? c.providerName, kind: m?.kind ?? "", active: true, fee: c });
  }
  for (const m of AUTOLARIS_KNOWN_CHANNELS) {
    if (seen.has(m.code)) continue;
    channels.push({ code: m.code, label: m.label, kind: m.kind, active: false, fee: null });
  }
  return { ok: true, channels };
}

/** One GET, no writes anywhere on the provider's side. Super-admin on-demand. */
export async function alProbeChannels(): Promise<AlProbeResult> {
  return mergeChannelProbe(await alListPayment());
}

// ── Fee reconciliation — REPORT ONLY, never adjust ─────────────────────────────────────────────
//
// 🔵 `@tokophi/lib/payment-fees` is an OWNER RULING (2026-08-24, specs/docs/FINANCE.md): QRIS 0,7%
// of omset, VA BCA Rp6.500 / other banks Rp3.500, e-wallet 3%, minimarket Rp4.000. Those numbers
// are what the SHOPPER is charged at checkout. The provider's `admin`/`tipe_admin` is what AutoLaris
// nets from the platform — a different fact, on a different side of the transaction. They are
// allowed to differ (that difference is platform margin, or platform absorption), so this function
// SURFACES a divergence and does not touch a single fee. Auto-syncing our schedule from the
// provider would silently move what shoppers pay, on a number no operator approved.
export type FeeComparisonRow = {
  code: string;
  label: string;
  ours: { type: "flat" | "pct"; value: number } | null;
  theirs: { type: AlFeeType; value: number | null; raw: string };
  verdict: "match" | "differs" | "not-compared";
  note: string;
};

/** PURE. `probe` is what `alProbeChannels` returned; only ACTIVE channels are worth comparing. */
export function compareChannelFees(channels: AlChannelProbe[]): FeeComparisonRow[] {
  const rows: FeeComparisonRow[] = [];
  for (const c of channels) {
    if (!c.active || !c.fee) continue;
    const theirs = { type: c.fee.feeType, value: c.fee.feeValue, raw: `${c.fee.rawAdmin} (${c.fee.rawTipeAdmin || "?"})` };
    const kind = c.kind as FeeKind;
    const known = kind === "va" || kind === "ewallet" || kind === "qris" || kind === "retail";
    if (!known) {
      // COD is the live instance: the provider lists it as a channel, but our COD cost is 3% of
      // (omset + ongkir) + PPN 11%, computed in `@tokophi/lib/order-finance`, NOT in the gateway
      // fee schedule. Comparing it against a `payment-fees` entry that does not exist would invent
      // a number. Say so instead.
      rows.push({ code: c.code, label: c.label, ours: null, theirs, verdict: "not-compared", note: "Tidak ada di jadwal biaya kami (mis. COD diatur terpisah di order-finance)." });
      continue;
    }
    const f = PAYMENT_FEES[kind];
    const ours = { type: f.type, value: channelFeeValue(kind, c.code) };
    if (theirs.type === "unknown" || theirs.value === null) {
      rows.push({ code: c.code, label: c.label, ours, theirs, verdict: "not-compared", note: "Format biaya provider tidak terbaca." });
      continue;
    }
    // A type mismatch (we charge flat, they charge a percentage) IS a divergence, not an excuse to
    // skip: it means the two sides scale differently with basket size.
    const same = ours.type === theirs.type && Math.abs(ours.value - theirs.value) < 1e-9;
    rows.push({
      code: c.code, label: c.label, ours, theirs,
      verdict: same ? "match" : "differs",
      note: same ? "Sama dengan jadwal kami." : "Beda — periksa FINANCE.md sebelum mengubah apa pun.",
    });
  }
  return rows;
}

async function al<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return (await res.json()) as T;
}

export type AlPayment = {
  ok: boolean;
  trxId?: string; virtualAccount?: string; qr?: string; paymentCode?: string; url?: string;
  amount?: number; admin?: number; total?: number; expiresAt?: string; error?: string;
};

export type AlPaymentStatus = {
  ok: boolean;
  trxId?: string;
  reffId?: string;
  status?: string;
  amount?: number;
  total?: number;
  paidAt?: string;
  error?: string;
};

// expired: default +24h, format YYYYMMDDHHMMSS
// ⚠️ AutoLaris reads `expired` as WIB — proven live 2026-09-01 against production create_payment:
// a stamp built from UTC "now + 1h" answered rc=08 "Invalid expired date" (it reads as the PAST in
// WIB), while the same instant shifted +7h passed validation. This function used the CONTAINER's
// local clock (`getHours()`), which is UTC in every deployed container — so production bills were
// silently valid for 17 hours, not the intended 24, and a container in any timezone west of UTC
// would emit stamps AutoLaris rejects outright, failing every payment. Pinned to WIB by arithmetic;
// never reintroduce local-clock reads here.
export function expiryStamp(msFromNow: number): string {
  const d = new Date(Date.now() + msFromNow + 7 * 3600 * 1000); // shift to WIB, then read as UTC
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export async function alCreatePayment(input: {
  reffId: string; channelCode: string; amount: number;
  customerId: string; customerName: string; customerPhone: string; customerEmail: string;
  callbackUrl: string;
}): Promise<AlPayment> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const r = await al<{ rc: string; ket?: string; data?: {
    trx_id?: string; virtual_account?: string; qr?: string; payment_code?: string; url?: string;
    amount?: number; admin?: number; total?: number;
  } }>("/api/h2h/create_payment", {
    reff_id: input.reffId,
    channel_code: input.channelCode,
    customer_id: input.customerId,
    customer_name: input.customerName,
    customer_phone: input.customerPhone,
    customer_email: input.customerEmail,
    expired: expiryStamp(expiresAt.getTime() - Date.now()),
    amount: String(input.amount),
    callback_url: input.callbackUrl,
  });
  if (r.rc !== AUTOLARIS_RC_OK || !r.data) return { ok: false, error: r.ket ?? `Gagal (rc=${r.rc})` };
  const d = r.data;
  return {
    ok: true, trxId: d.trx_id, virtualAccount: d.virtual_account || undefined, qr: d.qr || undefined,
    paymentCode: d.payment_code || undefined, url: d.url || undefined,
    amount: d.amount, admin: d.admin, total: d.total, expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Create a DIGITAL order via `/api/h2h/submit` — the shape the owner ruled for 2026-08-24 (AL-ORDER):
 * AutoLaris is a PAYMENT GATEWAY only (all shipping is KiriminAja), and their CMS detects a digital
 * order from **`courir_id: 1`**. Contract PROBED live 2026-08-24 against the real endpoint:
 *   · `channel_code` IS required — omitting it answers rc=01 "Invalid parameter" (measured), so the
 *     shopper's picked channel keeps flowing through exactly as with create_payment;
 *   · `origin`/`destination`/dims are required even for a digital order — dummy area ids + "1"s are
 *     accepted; `biaya_kirim` comes back 0;
 *   · the payment instruction arrives in `payment_info` (`va` / `qr` / `url` per channel) plus
 *     `transaction_id` — the SAME identifier family the callback reports as `trx_id`;
 *   · **`total` = `grand_total`** — unlike create_payment (total = amount + admin), the provider's
 *     admin fee (`biaya_admin`, e.g. VABCA 6.500 / QRIS 0,7%) is NOT added to what the buyer pays;
 *     it nets against settlement. The buyer therefore pays exactly the number WE computed — which
 *     already carries the platform fee schedule (specs/docs/FINANCE.md).
 * ⚠️ The vendor's field really is spelled `courir_id`. Do not "fix" the typo; the API owns it.
 */
export async function alCreateOrder(input: {
  reffId: string; channelCode: string; amount: number;
  customerName: string; customerPhone: string; customerEmail: string;
  callbackUrl: string;
  /** line items shown in the AutoLaris CMS; defaults to one line carrying the whole amount */
  items?: { name: string; qty: number; unitPrice: number }[];
}): Promise<AlPayment> {
  const items = input.items?.length ? input.items : [{ name: "Pesanan", qty: 1, unitPrice: input.amount }];
  const r = await al<{ rc: string; ket?: string; data?: {
    transaction_id?: string; channel_code?: string; total?: number; biaya_admin?: number; diskon?: number;
    payment_info?: { expired?: string; va?: string; qr?: string; url?: string };
  } }>("/api/h2h/submit", {
    reff_id: input.reffId,
    channel_code: input.channelCode,
    // 1 = digital order in the AutoLaris CMS — the whole reason this endpoint is used.
    courir_id: 1,
    // Required by their validator even when nothing ships; fixed dummy area ids from their own
    // sample (Sumobito / Sawahan) + 1-unit dims. biaya_kirim is 0 on every probed response.
    origin: 3517100, destination: 3518010,
    weight: "1", length: "1", width: "1", height: "1",
    shipper_name: "TokoPhi", shipper_phone: "081227168633", shipper_email: "billing@tokophi.id", shipper_address: "Pesanan digital TokoPhi",
    receiver_name: input.customerName, receiver_phone: input.customerPhone, receiver_email: input.customerEmail, receiver_address: "Pesanan digital",
    callback_url: input.callbackUrl,
    grand_total: String(input.amount), cod_value: "0",
    longitude: "", latitude: "",
    remark: `TokoPhi ${input.reffId}`,
    order_details: items.map((i) => ({ name: i.name, qty: String(i.qty), unit_price: String(i.unitPrice) })),
  });
  if (r.rc !== AUTOLARIS_RC_OK || !r.data) return { ok: false, error: r.ket ?? `Gagal (rc=${r.rc})` };
  const d = r.data;
  return {
    ok: true,
    trxId: d.transaction_id,
    virtualAccount: d.payment_info?.va || undefined,
    qr: d.payment_info?.qr || undefined,
    url: d.payment_info?.url || undefined,
    amount: input.amount, admin: d.biaya_admin, total: d.total,
    expiresAt: d.payment_info?.expired,
  };
}

// ── POST /api/h2h/advice — the DOCUMENTED reconciliation read ──────────────────────────────────
//
// Skill rule 7: "Reconcile a created transaction via `POST /api/h2h/advice` using the
// provider-issued `transaction_id`, never the local `reff_id`." Request shape is exactly
// `{ "transaction_id": "..." }`; the response is `rc` + `ket` + a `data` object whose only observed
// member is `awb` (a SHIPPING field — see the classifier below).
//
// 🔴 IT CANNOT SETTLE MONEY TODAY, AND THE CLASSIFIER BELOW IS WHY THAT IS SAFE. Driven live from
// the production admin container on 2026-09-09 against four real provider transaction ids taken
// from `payments`/`invoices` (read-only; no POST that creates anything was called):
//
//     trx 870161 (local `menunggu`) → {"rc":"02","ket":"FAILED","data":{"awb":""}}
//     trx 874901 (local `gagal`)    → {"rc":"02","ket":"FAILED","data":{"awb":""}}
//     trx 965568 (local `menunggu`) → {"rc":"02","ket":"FAILED","data":{"awb":""}}
//     trx 910957 (invoice, menunggu)→ {"rc":"02","ket":"FAILED","data":{"awb":""}}
//
// Every id answers identically, including two bills our own database still holds as LIVE and
// unpaid. The vendor's own documented sample for the same rc is `{"rc":"02","ket":"PENDING"}`. So
// `rc=02` is a single non-settled bucket, the `ket` word inside it does not track our local state,
// and no PAID answer has ever been observed here (all 203 `berhasil` payments on production are COD
// or seeded and carry no `trx_id`, so there is no settled transaction to ask about).
// Skill rule 8 stands: pending, generic success wording, and shipping vocabulary such as
// `DELIVERED` are not proof of payment.
export type AlAdvice = { ok: boolean; rc: string; ket: string; awb?: string; error?: string };

export type AdviceOutcome = "paid" | "pending" | "failed" | "unknown";

/**
 * The ONLY `ket` values that may ever mean "the money has settled".
 *
 * 🔴 IT IS DELIBERATELY EMPTY, AND EMPTY IS THE CORRECT VALUE UNTIL AUTOLARIS CONFIRMS THE MAPPING.
 * A wrong "paid" here credits a seller's withdrawable balance through `creditSaleForPayment` for
 * money that never arrived — the most expensive defect class in this repo. Adding a word to this
 * array is the entire change needed once the provider answers question 6 of the go-live list
 * ("mapping lengkap code/status Advice, dan kombinasi mana yang final paid"); until then nothing
 * reaches `paid`, by construction rather than by a caller remembering to be careful.
 */
export const ADVICE_SETTLED: readonly string[] = [];

/** Words that positively mean "not settled, and it never will be". */
const ADVICE_FAILED = ["FAILED", "GAGAL", "EXPIRED", "KEDALUWARSA", "CANCELLED", "CANCELED", "BATAL"];
/** Words that positively mean "not settled yet". */
const ADVICE_PENDING = ["PENDING", "MENUNGGU", "PROSES", "PROCESSING"];
/**
 * Words that LOOK like settlement and are not.
 * · `SUCCESS`/`BERHASIL` are the provider's generic envelope wording — the vendor guide says in as
 *   many words that they are "terlalu generik" and must not be read as paid;
 * · `DELIVERED` is SHIPPING vocabulary on a shared H2H transaction (the response's only `data`
 *   member is `awb`), so it describes a parcel, not a rupiah;
 * · `PAID` itself is unproven: it has never been observed from this endpoint, and guessing a
 *   settlement word is exactly what rule 8 forbids.
 * They resolve to `unknown` — never `paid`, and never quietly `pending` either, because a caller
 * that logs "unknown" surfaces the gap while "pending" would hide it.
 */
const ADVICE_DECEPTIVE = ["SUCCESS", "BERHASIL", "SUKSES", "DELIVERED", "TERKIRIM", "PAID", "LUNAS", "SETTLED"];

/**
 * PURE. Map one Advice answer to a settlement outcome. **The default is `unknown`, never `paid`.**
 * No network, no env — so the one rule that decides whether money moves is directly testable.
 */
export function classifyAdvice(rc: string | null | undefined, ket: string | null | undefined): { outcome: AdviceOutcome; reason: string } {
  const code = (rc ?? "").trim();
  const word = (ket ?? "").trim().toUpperCase();
  const at = `rc=${code || "?"} ket=${word || "?"}`;
  if (ADVICE_SETTLED.includes(word)) return { outcome: "paid", reason: `Status settlement yang dikonfirmasi provider (${at}).` };
  if (ADVICE_DECEPTIVE.includes(word)) {
    return { outcome: "unknown", reason: `"${word}" bukan bukti pembayaran — kata generik / kosakata pengiriman (${at}). Rekonsiliasi manual.` };
  }
  if (ADVICE_FAILED.includes(word)) return { outcome: "failed", reason: `Transaksi tidak lunas (${at}).` };
  if (ADVICE_PENDING.includes(word)) return { outcome: "pending", reason: `Belum lunas (${at}).` };
  return { outcome: "unknown", reason: `Status tidak dikenali (${at}). Rekonsiliasi manual.` };
}

/**
 * Read one provider transaction. Creates nothing. `transactionId` is the PROVIDER's id
 * (`data.transaction_id` from `/submit`, or `trx_id` from `/create_payment`) — never a local
 * `reff_id`, per skill rule 7.
 */
export async function alAdvice(transactionId: string): Promise<AlAdvice> {
  const id = transactionId.trim();
  if (!id) return { ok: false, rc: "", ket: "", error: "transaction_id wajib diisi." };
  if (!KEY) return { ok: false, rc: "", ket: "", error: "API key belum diisi (AUTOLARIS_API_KEY)." };
  try {
    const r = await al<{ rc?: string; ket?: string; data?: { awb?: string } }>("/api/h2h/advice", { transaction_id: id });
    return { ok: true, rc: String(r.rc ?? ""), ket: String(r.ket ?? ""), awb: r.data?.awb || undefined };
  } catch (e) {
    return { ok: false, rc: "", ket: "", error: e instanceof Error ? e.message : "Gagal terhubung." };
  }
}

/**
 * Ask AutoLaris for the gateway's current view of a transaction instead of trusting a callback body.
 * `ok` means the inquiry itself succeeded; callers must still require `status === "PAID"` and compare
 * the returned amount with their own payment row before settling money.
 *
 * 🔴 NOTHING IN THIS REPOSITORY CALLS THIS, AND THE ENDPOINT DOES NOT EXIST ON OUR ACCOUNT.
 * `inquiry_payment` is not one of the eight endpoints the vendor publishes. Driven live from the
 * production admin container on 2026-09-09 against four real provider transaction ids, every one
 * answered **`{"rc":"404","ket":"not found"}`** — including ids `/api/h2h/advice` answers for in the
 * same session. Its unit test in `pay-callback.test.ts` stubs `fetch`, so it has always been green
 * over a path the provider does not serve: a guard passing for the wrong reason.
 *
 * It is kept, not deleted, for one reason: settlement is decided in
 * `apps/admin/app/api/public/pay/callback/route.ts` (`status === "PAID"` → `berhasil` →
 * `creditSaleForPayment`) and nothing here is on that path, so removing it changes no behaviour and
 * would only discard a shape to re-confirm with the vendor. **Do not wire it to anything, and do not
 * present it as a settlement source, until AutoLaris confirms the path.** `alAdvice` above is the
 * documented reconciliation read — and it cannot settle either; see its own note.
 */
export async function alInquirePaymentStatus(trxId: string): Promise<AlPaymentStatus> {
  const normalizedTrxId = trxId.trim();
  if (!normalizedTrxId) return { ok: false, error: "trx_id wajib diisi." };

  const r = await al<{
    rc: string;
    ket?: string;
    data?: {
      trx_id?: string;
      reff_id?: string;
      status?: string;
      amount?: number;
      total?: number;
      paid_at?: string;
    };
  }>("/api/h2h/inquiry_payment", { trx_id: normalizedTrxId });

  if (r.rc !== AUTOLARIS_RC_OK || !r.data) {
    return { ok: false, error: r.ket ?? `Gagal (rc=${r.rc})` };
  }

  return {
    ok: true,
    trxId: r.data.trx_id,
    reffId: r.data.reff_id,
    status: r.data.status?.toUpperCase(),
    amount: r.data.amount,
    total: r.data.total,
    paidAt: r.data.paid_at,
  };
}

// live connectivity check (super-admin) — creates a minimal QRIS bill and checks rc=00
export async function alTestConnection(): Promise<{ ok: boolean; message: string }> {
  if (!KEY) return { ok: false, message: "API key belum diisi (AUTOLARIS_API_KEY)." };
  try {
    const r = await alCreatePayment({
      reffId: `PING-${expiryStamp(0)}`, channelCode: "QRIS", amount: 10000,
      customerId: "0", customerName: "Konektivitas", customerPhone: "081200000000",
      customerEmail: "ping@tokophi.id", callbackUrl: `${BASE}/noop`,
    });
    return r.ok
      ? { ok: true, message: `Terhubung ke payment gateway — biaya admin Rp${(r.admin ?? 0).toLocaleString("id-ID")}.` }
      : { ok: false, message: r.error ?? "Auth ditolak / respons tidak valid." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal terhubung." };
  }
}
