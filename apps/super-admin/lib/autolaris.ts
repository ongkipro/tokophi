import "server-only";

// AutoLaris payment-gateway connectivity check for the platform control plane.
const BASE = process.env.AUTOLARIS_BASE ?? "https://api-h2h.autolaris.com";
const KEY = process.env.AUTOLARIS_API_KEY ?? "";

export const autolarisConfigured = () => !!KEY;

export async function alTestConnection(): Promise<{ ok: boolean; message: string }> {
  if (!KEY) return { ok: false, message: "API key belum diisi (AUTOLARIS_API_KEY di .env.local)." };
  const stamp = (() => {
    const d = new Date(); const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  })();
  const expired = (() => {
    const d = new Date(Date.now() + 3600_000); const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  })();
  try {
    const res = await fetch(`${BASE}/api/h2h/create_payment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        reff_id: `PING-${stamp}`, channel_code: "QRIS", customer_id: "0", customer_name: "Konektivitas",
        customer_phone: "081200000000", customer_email: "ping@tokophi.id", expired, amount: "10000",
        callback_url: `${BASE}/noop`,
      }),
      cache: "no-store",
    });
    const j = (await res.json()) as { rc?: string; ket?: string; data?: { admin?: number } };
    return j.rc === "00"
      ? { ok: true, message: `Terhubung ke payment gateway — biaya admin Rp${(j.data?.admin ?? 0).toLocaleString("id-ID")}.` }
      : { ok: false, message: j.ket ?? `Auth ditolak (rc=${j.rc}).` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal terhubung." };
  }
}
