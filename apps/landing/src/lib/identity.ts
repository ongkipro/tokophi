// Who TokoΦ legally is, and how to reach us.
//
// The defaults below are the owner's own statement (2026-10-14): entity, registered address, the
// support mailbox and the platform WhatsApp. Nothing else may be put here — a placeholder rendered on
// a legal page IS a published claim. A build env var still overrides each one; an empty value falls
// back to the default, and a field with neither renders as an explicit "belum dicantumkan" notice:
//
//   PUBLIC_LEGAL_NAME      e.g. "PT Contoh Digital Nusantara"  (badan usaha / perorangan)
//   PUBLIC_LEGAL_ADDRESS   full registered address
//   PUBLIC_CONTACT_EMAIL   a mailbox somebody actually reads
//   PUBLIC_CONTACT_WHATSAPP  digits only, 62… — the platform's own number, NOT a merchant's
//
// `||`, not `??`: an unset Docker ARG becomes an EMPTY STRING env var, not undefined (same trap the
// CTA URLs already carry a comment about — it shipped once and the live buttons had no target).
export const IDENTITY = {
  legalName: (import.meta.env.PUBLIC_LEGAL_NAME as string | undefined) || "PT Tokophi Nusantara",
  address:
    (import.meta.env.PUBLIC_LEGAL_ADDRESS as string | undefined) ||
    "Perumahan The Gayungsari, Jl. Gayungsari Timur Blok H-I No. 01, Gayungan, Kec. Gayungan, Surabaya, Jawa Timur 60234",
  email: (import.meta.env.PUBLIC_CONTACT_EMAIL as string | undefined) || "hello@tokophi.com",
  whatsapp: (import.meta.env.PUBLIC_CONTACT_WHATSAPP as string | undefined) || "6281283098098",
} as { legalName: string | null; address: string | null; email: string | null; whatsapp: string | null };

/** "6281283098098" → "+62 812-8309-8098": the number as people read it; the link keeps the digits. */
export const whatsappDisplay = (n: string) =>
  `+62 ${n.replace(/^62/, "").replace(/^(\d{3})(\d{4})(\d+)$/, "$1-$2-$3")}`;

/** A reader can reach a human. Either channel is enough. */
export const HAS_CONTACT = Boolean(IDENTITY.email || IDENTITY.whatsapp);

/** Everything a UU PDP notice has to name about its publisher is present. */
export const IDENTITY_COMPLETE = Boolean(IDENTITY.legalName && IDENTITY.address) && HAS_CONTACT;

/** What is still missing, in words — printed on the page rather than silently omitted. */
export const MISSING_IDENTITY: string[] = [
  IDENTITY.legalName ? null : "nama badan usaha",
  IDENTITY.address ? null : "alamat terdaftar",
  HAS_CONTACT ? null : "kanal kontak resmi (email atau WhatsApp)",
].filter((x): x is string => x !== null);
