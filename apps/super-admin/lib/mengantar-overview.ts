// Mengantar multi-seller — what the operator READS on /pengiriman (pure: no DB, no clock).
//
// Two questions the page used to leave to the operator's memory of ADR 0018/0019:
//  1. "Can TokoΦ register a Mengantar account for another store right now?" — five platform facts,
//     spread over env vars, the partner-credential card and the platform switch on /pengaturan.
//  2. "What does this store's account need?" — the raw state (`pending`) hid WHY it waits: the owner's
//     consent, store approval, a rate limit, or a partner configuration that cannot work yet.
// Labels and next steps live here so the page, and its test, say the same thing.

import type { ProviderStatus } from "./data";

export type MgTone = "ok" | "wait" | "problem" | "muted";
/** `history` = an account row whose store is on KiriminAja: kept, never quoted (ADR 0019). */
export type MgBucket = "connected" | "waiting" | "problem" | "history";
/**
 * The ONE operator action that can help this row (the actions re-check; this only decides what is drawn):
 * `rotate` — a partner-made connected account (never an owner-attached one, O11, nor a KiriminAja store's
 * history row); `register` — a Mengantar store whose account can be (re)queued. Waiting on the owner's
 * consent or on store approval is NOT something a retry fixes, so no button.
 */
export type MgAction = "rotate" | "register" | null;
export type MgAccountView = { label: string; tone: MgTone; bucket: MgBucket; hint: string | null; action: MgAction };

export type MgAccountFacts = {
  provider: string;
  state: string;
  lastErrorCode: string | null;
  lastError: string | null;
  partnerId: string | null;
};

const RATE_LIMIT = new Set(["RATE_LIMITED", "DAILY_REGISTRATION_LIMIT"]);

export function accountView(r: MgAccountFacts): MgAccountView {
  return { ...describe(r), action: actionFor(r) };
}

function actionFor(r: MgAccountFacts): MgAction {
  if (r.provider !== "mengantar") return null;
  if (r.state === "connected") return r.partnerId ? "rotate" : null;
  if (r.state === "registering" || r.state === "rotating") return null;
  if (r.state === "pending" && (r.lastErrorCode === "awaiting_consent" || r.lastErrorCode === "awaiting_approval")) return null;
  return "register";
}

function describe(r: MgAccountFacts): Omit<MgAccountView, "action"> {
  if (r.provider !== "mengantar") {
    return { label: "Tidak dipakai", tone: "muted", bucket: "history", hint: "Toko memakai KiriminAja; akun ini disimpan sebagai riwayat." };
  }
  const code = r.lastErrorCode ?? "";
  switch (r.state) {
    case "connected":
      // O11: an account the owner attached by hand has no partner id and is never rotated via the Partner API.
      return r.partnerId
        ? { label: "Terhubung", tone: "ok", bucket: "connected", hint: r.lastError }
        : { label: "Terhubung · akun owner", tone: "ok", bucket: "connected", hint: "Dilampirkan manual (O11) — tidak diperbarui lewat Partner API." };
    case "none":
      return { label: "Belum ada akun", tone: "wait", bucket: "waiting", hint: "Klik Daftarkan untuk membuat akun Mengantar toko ini." };
    case "pending":
      if (code === "awaiting_consent")
        return { label: "Menunggu persetujuan pemilik", tone: "wait", bucket: "waiting", hint: "Pemilik toko harus menyetujui syarat Mengantar di Pengaturan Seller → Akun Mengantar." };
      if (code === "awaiting_approval")
        return { label: "Menunggu toko disetujui", tone: "wait", bucket: "waiting", hint: "Akun dibuat otomatis setelah pendaftaran toko disetujui." };
      if (code === "configuration_blocked")
        return { label: "Tertahan konfigurasi", tone: "problem", bucket: "problem", hint: r.lastError ?? "Konfigurasi Partner belum siap — lihat Kesiapan di atas." };
      if (RATE_LIMIT.has(code))
        return { label: "Antre · dibatasi Mengantar", tone: "wait", bucket: "waiting", hint: "Dicoba ulang otomatis setelah batas Mengantar lewat." };
      return { label: "Antre", tone: "wait", bucket: "waiting", hint: r.lastError ?? "Dicoba ulang otomatis." };
    case "registering":
      return { label: "Mendaftar", tone: "wait", bucket: "waiting", hint: r.lastError ?? "Sedang didaftarkan ke Mengantar." };
    case "rotating":
      return { label: "Ganti kunci", tone: "wait", bucket: "waiting", hint: "Kunci baru sedang dibuat; booking toko ini menunggu sebentar." };
    case "email_taken":
      return { label: "Email sudah dipakai", tone: "problem", bucket: "problem", hint: "Email pemilik sudah punya akun Mengantar di luar TokoΦ — akun tidak bisa dibuat dengan email itu." };
    case "blocked":
      return { label: "Diblokir", tone: "problem", bucket: "problem", hint: r.lastError ?? "Akun dinonaktifkan oleh Mengantar." };
    case "failed":
      return { label: "Ditolak", tone: "problem", bucket: "problem", hint: r.lastError ?? "Pendaftaran ditolak Mengantar." };
    default:
      return { label: r.state, tone: "problem", bucket: "problem", hint: r.lastError };
  }
}

export type MgReadinessStep = { key: string; label: string; ok: boolean; detail: string };

/**
 * The platform half of "can another store get Mengantar?", in the order an operator fixes it. The
 * first four gate REGISTRATION (and the switch, `mengantarReadiness`); the fifth decides whether a
 * connected store's checkout actually quotes Mengantar.
 */
export function readinessSteps(p: Pick<ProviderStatus, "mengantar" | "shipping" | "encryptionAvailable">): MgReadinessStep[] {
  const env = p.mengantar.env;
  const slot = p.mengantar.slots[env];
  return [
    {
      key: "env",
      label: "Lingkungan Mengantar ditetapkan",
      ok: p.mengantar.envNamed,
      detail: p.mengantar.envNamed ? `MENGANTAR_ENV = ${env}` : "MENGANTAR_ENV belum diset di Coolify (kosong dibaca sandbox).",
    },
    {
      key: "origin",
      label: `Origin Partner API ${env} dari Mengantar`,
      ok: slot.originKnown,
      detail: slot.originKnown ? "Diketahui." : `Menunggu Mengantar: origin Partner API ${env} + allow-list IP server (O2).`,
    },
    {
      key: "partner",
      label: `Kredensial Partner ${env}`,
      ok: slot.source !== "none",
      detail: slot.source === "none" ? "Simpan Partner ID + secret di Pengaturan → Kurir." : `Partner ${slot.partnerId ?? "—"} (${slot.source === "db" ? "tersimpan" : "env"}).`,
    },
    {
      key: "encryption",
      label: "Kunci enkripsi akun toko",
      ok: p.encryptionAvailable,
      detail: p.encryptionAvailable ? "INTEGRATION_TOKEN_KEY tersedia." : "INTEGRATION_TOKEN_KEY belum diset — kunci akun toko tidak bisa disimpan.",
    },
    {
      key: "switch",
      label: "Saklar utama Mengantar",
      ok: p.shipping.active === "mengantar",
      detail: p.shipping.active === "mengantar" ? "Menyala — toko Mengantar yang terhubung memakai Mengantar." : "Mati — semua toko memakai KiriminAja (Pengaturan → Kurir).",
    },
  ];
}

export type MgSummary = { onMengantar: number; connected: number; waiting: number; problem: number };

export function summarize(rows: MgAccountFacts[]): MgSummary {
  const s: MgSummary = { onMengantar: 0, connected: 0, waiting: 0, problem: 0 };
  for (const r of rows) {
    if (r.provider !== "mengantar") continue;
    s.onMengantar++;
    const b = accountView(r).bucket;
    if (b === "connected") s.connected++;
    else if (b === "waiting") s.waiting++;
    else if (b === "problem") s.problem++;
  }
  return s;
}
