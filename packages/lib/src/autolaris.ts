import "server-only";
import { AUTOLARIS_RC_OK, channelActiveFromRc, isConfigured } from "./integration-status";

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

// Full roster we probe to discover which channels the platform's AutoLaris account has active
// (AutoLaris H2H has no list-channels endpoint — create_payment rc=00 = active, rc=07 = not active).
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

export type AlChannelProbe = { code: string; label: string; kind: string; active: boolean };

// Probe every known channel live. EXPENSIVE — one create_payment per channel (creates sandbox
// bills). Call on-demand from super-admin only, never on render.
export async function alProbeChannels(): Promise<AlChannelProbe[]> {
  if (!KEY) return [];
  const out: AlChannelProbe[] = [];
  for (const c of AUTOLARIS_KNOWN_CHANNELS) {
    try {
      const r = await al<{ rc: string }>("/api/h2h/create_payment", {
        reff_id: `PROBE-${c.code}-${expiryStamp(0)}`,
        channel_code: c.code,
        customer_id: "0",
        customer_name: "Probe",
        customer_phone: "081200000000",
        customer_email: "probe@tokophi.id",
        expired: expiryStamp(24 * 60 * 60 * 1000),
        amount: "15000",
        callback_url: `${BASE}/noop`,
      });
      out.push({ code: c.code, label: c.label, kind: c.kind, active: channelActiveFromRc(r.rc) });
    } catch {
      out.push({ code: c.code, label: c.label, kind: c.kind, active: false });
    }
  }
  return out;
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
function expiryStamp(msFromNow: number): string {
  const d = new Date(Date.now() + msFromNow);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
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
 * Ask AutoLaris for the gateway's current view of a transaction instead of trusting a callback body.
 * `ok` means the inquiry itself succeeded; callers must still require `status === "PAID"` and compare
 * the returned amount with their own payment row before settling money.
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
