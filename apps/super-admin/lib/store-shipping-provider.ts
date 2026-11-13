import type { PlatformRole } from "./platform-rank";
import { SHIPPING_PROVIDERS, type ShippingProvider } from "@tokophi/lib/provider-config";
import { normalizeSignupCode } from "@tokophi/lib/signup-code";

// ADR 0019 — the per-store shipping provider and the signup codes that set it at signup. Owner, 2026-11-13:
// "Super admin yang menentukan dan atau via code ketika register" · "default pakai KiriminAja" · "bentuk kode
// daftar dari super admin aja, yang boleh mengganti ya super admin".
//
// PURE (no `@tokophi/db` import): the decisions take their reads and writes as `deps`, so they are tested
// with fakes (`store-shipping-provider.test.ts`), and `route-roles.ts` can import the rank constant below
// without dragging a database connection into the route table.

/**
 * 🔵 THE ONE RANK for both screens' mutations and the codes route floor. The owner named "Super Admin"
 * without a rank; OWNER is the default because the platform switch and the partner credential beside it are
 * owner rank (one fewer way to put a merchant on a money path an `admin` could not otherwise reach).
 * Lowering it to `admin` is THIS one line — `setStoreShippingProvider`, `createSignupCode`,
 * `setSignupCodeActive` (actions.ts) and the `/kode-daftar` floor (route-roles.ts) all read it.
 */
export const SHIPPING_PROVIDER_MIN_RANK: PlatformRole = "owner";

export const PROVIDER_LABEL: Record<ShippingProvider, string> = { kiriminaja: "KiriminAja", mengantar: "Mengantar" };
export const isShippingProvider = (v: unknown): v is ShippingProvider => (SHIPPING_PROVIDERS as readonly unknown[]).includes(v);
const label = (v: string | null | undefined) => (isShippingProvider(v) ? PROVIDER_LABEL[v] : String(v ?? "—"));

/** A reason is required: it moves a merchant's money path, and the audit line is how anyone reviews it. */
export const STORE_PROVIDER_REASON_MIN = 5;

export type Result = { ok: boolean; message: string };

export type StoreProviderDeps = {
  /** The store's name + current provider (owner pool, `where id = …`). null = no such store. */
  read: (storeId: string) => Promise<{ name: string; provider: string } | null>;
  /** UPDATE … RETURNING shipping_provider — what was actually written (null = no row). */
  write: (storeId: string, provider: ShippingProvider) => Promise<string | null>;
  /** The store's Mengantar account state in the active env (`none` = no row). */
  accountState: (storeId: string) => Promise<string>;
  /** Queue the store's Mengantar account WITHOUT consent (`enqueueMengantarConnect`, source operator). */
  queueAccount: (storeId: string) => Promise<void>;
  log: (storeId: string, text: string) => Promise<void>;
};

/**
 * Move ONE store to a provider. Rules (ADR 0019):
 *   · switching TO Mengantar queues the store's account when it has none — `pending` + `awaiting_consent`
 *     (an operator never consents for an owner; the owner presses "Hubungkan Mengantar" in Pengaturan). An
 *     account that already exists is left as it is (a connected one starts quoting at once).
 *   · switching AWAY leaves the account row untouched; the dispatch simply stops quoting through it.
 *   · existing orders keep their own `orders.shipping_provider` stamp — booking, tracking and cancel follow it.
 *   · the audit line names before → after as RE-READ from the write, and the operator and the reason.
 */
export async function setStoreShippingProviderWith(deps: StoreProviderDeps, operatorEmail: string, storeId: string, target: string, reason: string): Promise<Result> {
  if (!isShippingProvider(target)) return { ok: false, message: "Penyedia pengiriman tidak dikenal." };
  const why = String(reason ?? "").trim();
  if (why.length < STORE_PROVIDER_REASON_MIN) {
    return { ok: false, message: `Tulis alasan perubahan (minimal ${STORE_PROVIDER_REASON_MIN} karakter) — alasannya masuk ke log aktivitas toko.` };
  }
  const before = await deps.read(storeId);
  if (!before) return { ok: false, message: "Toko tidak ditemukan — tidak ada yang diubah." };
  if (before.provider === target) return { ok: true, message: `“${before.name}” sudah memakai ${PROVIDER_LABEL[target]}.` };

  const written = await deps.write(storeId, target);
  let account = "";
  if (written === "mengantar") {
    const st = await deps.accountState(storeId);
    if (st === "none") {
      await deps.queueAccount(storeId);
      account = " Akun Mengantar toko diantrekan dan menunggu persetujuan pemilik di Pengaturan → Pengiriman (tidak didaftarkan tanpa persetujuan).";
    } else {
      account = ` Akun Mengantar toko sudah ada (status ${st}).`;
    }
  }
  await deps.log(
    storeId,
    `Penyedia pengiriman toko diubah ${label(before.provider)} → ${label(target)} oleh ${operatorEmail} — alasan: ${why}. ` +
      `Hasil tersimpan: ${label(written)}.${account} Pesanan lama tetap di penyedia masing-masing; COD selalu KiriminAja.`,
  );
  if (written !== target) return { ok: false, message: `Penulisan tidak berlaku — penyedia tersimpan: ${label(written)}.` };
  return {
    ok: true,
    message:
      target === "mengantar"
        ? `“${before.name}” kini memakai Mengantar untuk checkout non-COD, begitu akun Mengantar-nya terhubung.${account}`
        : `“${before.name}” kini memakai KiriminAja untuk semua checkout baru. Pesanan Mengantar yang sudah ada tetap dilacak lewat akunnya.`,
  };
}

// ─── Signup codes ────────────────────────────────────────────────────────────────────────────────

export const SIGNUP_CODE_NOTE_MAX = 200;

export type SignupCodeDeps = {
  /** INSERT; "duplicate" when the code already exists (PK). */
  insert: (row: { code: string; provider: ShippingProvider; note: string | null; createdBy: string | null }) => Promise<"ok" | "duplicate">;
  /** UPDATE … SET active RETURNING active (null = no such code). */
  setActive: (code: string, active: boolean) => Promise<boolean | null>;
  log: (text: string) => Promise<void>;
};

export async function createSignupCodeWith(
  deps: SignupCodeDeps,
  operator: { id: string | null; email: string },
  rawCode: string,
  provider: string,
  rawNote: string,
): Promise<Result> {
  const code = normalizeSignupCode(rawCode);
  if (!code) return { ok: false, message: "Kode 3–32 karakter: huruf, angka, dan tanda minus (tidak boleh diawali minus)." };
  if (!isShippingProvider(provider)) return { ok: false, message: "Pilih penyedia pengiriman untuk kode ini." };
  const note = String(rawNote ?? "").trim();
  if (note.length > SIGNUP_CODE_NOTE_MAX) return { ok: false, message: `Catatan maksimal ${SIGNUP_CODE_NOTE_MAX} karakter.` };
  const r = await deps.insert({ code, provider, note: note || null, createdBy: operator.id });
  if (r === "duplicate") return { ok: false, message: `Kode ${code} sudah ada. Kode tidak pernah dihapus — aktifkan lagi yang lama, atau pakai kode lain.` };
  await deps.log(`Kode daftar ${code} (pengiriman: ${PROVIDER_LABEL[provider]}) dibuat oleh ${operator.email}${note ? ` — catatan: ${note}` : ""}.`);
  return { ok: true, message: `Kode ${code} aktif. Bagikan tautan /daftar?kode=${code}.` };
}

export async function setSignupCodeActiveWith(deps: SignupCodeDeps, operatorEmail: string, rawCode: string, active: boolean): Promise<Result> {
  const code = normalizeSignupCode(rawCode);
  if (!code) return { ok: false, message: "Kode tidak dikenal." };
  const now = await deps.setActive(code, active);
  if (now === null) return { ok: false, message: "Kode tidak dikenal." };
  await deps.log(`Kode daftar ${code} ${now ? "DIAKTIFKAN" : "DINONAKTIFKAN"} oleh ${operatorEmail}.`);
  return now === active
    ? { ok: true, message: active ? `Kode ${code} aktif lagi.` : `Kode ${code} dinonaktifkan — pendaftaran dengan kode ini ditolak mulai sekarang.` }
    : { ok: false, message: `Penulisan tidak berlaku — kode ${code} masih ${now ? "aktif" : "nonaktif"}.` };
}
