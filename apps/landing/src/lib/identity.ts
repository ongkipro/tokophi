// Who TokoΦ legally is, and how to reach us.
//
// ⚠️ DELIBERATELY NOT HARD-CODED. Nothing in this repository establishes the operating entity, its
// registered address or a monitored support channel — and a placeholder rendered as text on a legal
// page IS a published claim, indistinguishable to a reader (or to an ads reviewer) from a real one.
// Unset therefore renders as an explicit "belum dicantumkan" notice naming what is missing, never as
// an invented value. Filling these is a build-env change, not a code change:
//
//   PUBLIC_LEGAL_NAME      e.g. "PT Contoh Digital Nusantara"  (badan usaha / perorangan)
//   PUBLIC_LEGAL_ADDRESS   full registered address
//   PUBLIC_CONTACT_EMAIL   a mailbox somebody actually reads
//   PUBLIC_CONTACT_WHATSAPP  digits only, 62… — the platform's own number, NOT a merchant's
//
// `||`, not `??`: an unset Docker ARG becomes an EMPTY STRING env var, not undefined (same trap the
// CTA URLs already carry a comment about — it shipped once and the live buttons had no target).
export const IDENTITY = {
  legalName: (import.meta.env.PUBLIC_LEGAL_NAME as string | undefined) || null,
  address: (import.meta.env.PUBLIC_LEGAL_ADDRESS as string | undefined) || null,
  email: (import.meta.env.PUBLIC_CONTACT_EMAIL as string | undefined) || null,
  whatsapp: (import.meta.env.PUBLIC_CONTACT_WHATSAPP as string | undefined) || null,
} as const;

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
