// The POST half of `/affiliate` (Task 9.5, F-A1/F-A2), lifted out of the page so its order of checks is
// testable: honeypot → rate limit → name → phone → write. The store id never comes from the form; the
// page passes `apply` already bound to the Host-resolved store.
import { normalizePhone } from "@tokophi/lib/validate";
import type { AffiliateApplication } from "../data/affiliate";

export type AffiliateFormValues = {
  name: string;
  phone: string;
  email: string;
  channel: string;
  bankName: string;
  bankAccount: string;
  bankHolder: string;
};

export type AffiliateApplyDeps = {
  /** One unit of the per-IP budget; false = over the limit. Called only for a non-bot submission. */
  allow: () => boolean;
  apply: (a: AffiliateApplication) => Promise<"created" | "exists" | "failed">;
};

const clip = (v: FormDataEntryValue | null, n: number) => String(v ?? "").trim().slice(0, n);

export async function handleAffiliateApplication(f: FormData, deps: AffiliateApplyDeps) {
  const values: AffiliateFormValues = {
    name: clip(f.get("name"), 80),
    phone: clip(f.get("phone"), 32),
    email: clip(f.get("email"), 120),
    channel: clip(f.get("channel"), 300),
    bankName: clip(f.get("bankName"), 60),
    bankAccount: clip(f.get("bankAccount"), 40),
    bankHolder: clip(f.get("bankHolder"), 80),
  };
  let outcome: "form" | "ok" | "exists" = "form";
  let error = "";
  const phone = normalizePhone(values.phone);
  if (clip(f.get("website"), 100)) {
    outcome = "ok"; // honeypot filled: a bot. Answer like a success so it learns nothing.
  } else if (!deps.allow()) {
    error = "Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.";
  } else if (!values.name) {
    error = "Nama wajib diisi.";
  } else if (!phone) {
    error = "Nomor WhatsApp tidak valid.";
  } else {
    const r = await deps.apply({
      name: values.name,
      phone,
      email: values.email || null,
      channel: values.channel || null,
      bankName: values.bankName || null,
      bankAccount: values.bankAccount || null,
      bankHolder: values.bankHolder || null,
    });
    if (r === "created") outcome = "ok";
    else if (r === "exists") outcome = "exists";
    if (outcome === "form") error = "Gagal menyimpan pendaftaran, coba lagi.";
  }
  return { outcome, error, values };
}
