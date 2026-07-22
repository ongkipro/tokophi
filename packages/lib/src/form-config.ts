// Which OPTIONAL order-form elements a landing shows. The 4 core COD fields (nama / WhatsApp / alamat /
// kecamatan) are always shown — hiding them would break a COD order — so they are not toggleable here.
// Stored as jsonb on promo_pages / landing_pages; the OrderFunnel reads it. Missing keys take the
// defaults below, so an empty {} (existing rows) behaves exactly like the original fixed form.
export type FormConfig = {
  email: boolean; // optional email input → customer.email
  quantity: boolean; // qty stepper (else fixed 1)
  trustBadges: boolean; // the DATA AMAN / PRODUK ASLI / BAYAR DI TEMPAT row
  summary: boolean; // the Ringkasan Pesanan block
};

export const FORM_CONFIG_DEFAULTS: FormConfig = {
  email: false,
  quantity: false,
  trustBadges: true,
  summary: true,
};

/** Merge a stored (possibly partial / unknown) value onto the defaults. Always returns a full config. */
export function resolveFormConfig(raw: unknown): FormConfig {
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    email: typeof c.email === "boolean" ? c.email : FORM_CONFIG_DEFAULTS.email,
    quantity: typeof c.quantity === "boolean" ? c.quantity : FORM_CONFIG_DEFAULTS.quantity,
    trustBadges: typeof c.trustBadges === "boolean" ? c.trustBadges : FORM_CONFIG_DEFAULTS.trustBadges,
    summary: typeof c.summary === "boolean" ? c.summary : FORM_CONFIG_DEFAULTS.summary,
  };
}
