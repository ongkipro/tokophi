import "server-only";

// KiriminAja connectivity check for the platform control plane. The merchant-facing calls
// (rates/orders) live in apps/admin; here we only verify the platform's key + reachability.
const ENV = process.env.KIRIMINAJA_ENV ?? "sandbox";
const BASE = ENV === "production" ? "https://client.kiriminaja.com" : "https://tdev.kiriminaja.com";
const KEY = process.env.KIRIMINAJA_API_KEY ?? "";

export const kiriminajaConfigured = () => !!KEY;
export const kiriminajaEnv = () => ENV;

export async function kaTestConnection(): Promise<{ ok: boolean; env: string; provinces?: number; message: string }> {
  if (!KEY) return { ok: false, env: ENV, message: "API key belum diisi (KIRIMINAJA_API_KEY di .env.local)." };
  try {
    const res = await fetch(`${BASE}/api/mitra/province`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    const j = (await res.json()) as { status?: boolean; datas?: unknown[] };
    return j.status
      ? { ok: true, env: ENV, provinces: (j.datas ?? []).length, message: `Terhubung (${ENV}) — ${(j.datas ?? []).length} provinsi.` }
      : { ok: false, env: ENV, message: "Auth ditolak / respons tidak valid." };
  } catch (e) {
    return { ok: false, env: ENV, message: e instanceof Error ? e.message : "Gagal terhubung." };
  }
}
