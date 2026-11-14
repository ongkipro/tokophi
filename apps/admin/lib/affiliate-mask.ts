// F-A12 (specs/AFFILIATE_SPEC.md): a store user without `affiliates:write` (staff, cs, gudang) may
// work the affiliate list but must not receive an affiliate's phone, email or bank account. Masking
// happens HERE, on the server, before the row reaches the client — hiding it in the UI would still
// ship the digits in the RSC payload.

/** Keep the last 4 characters: `081283098098` → `••••8098`. Short values are masked whole. */
export function maskTail(value: string, keep = 4): string {
  const v = value.replace(/\s+/g, "");
  return v.length > keep ? `••••${v.slice(-keep)}` : "••••";
}

/** `sari@gmail.com` → `s•••@gmail.com`. */
export function maskEmail(value: string): string {
  const at = value.indexOf("@");
  return at > 0 ? `${value[0]}•••${value.slice(at)}` : "••••";
}

export type AffiliateContact = {
  phone: string;
  email: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
};

/** The phone / email / bank line the Seller panel may show for this viewer. */
export function affiliateContactView(a: AffiliateContact, full: boolean) {
  const account = a.bankAccount && (full ? a.bankAccount : maskTail(a.bankAccount));
  return {
    phone: full ? a.phone : maskTail(a.phone),
    email: a.email && (full ? a.email : maskEmail(a.email)),
    bank: a.bankName ? [a.bankName, account, a.bankHolder && `a.n. ${a.bankHolder}`].filter(Boolean).join(" · ") : null,
    contactMasked: !full,
  };
}
