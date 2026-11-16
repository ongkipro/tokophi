// Product-wide switches decided by the OWNER, compiled in. Flipping one is a code change + deploy,
// on purpose: these are "is this feature part of the product right now", not per-store settings.

/**
 * Obrolan — shopper ⇄ seller chat (specs/docs/CHAT_SPEC.md): the storefront bubble, the Header / PDP /
 * /kontak "chat" buttons, `/api/chat/*`, and the Seller inbox `/obrolan` with its sidebar row.
 *
 * HIDDEN since 2026-11-16 (owner: "obrolan hide aja dulu di admin maupun storefront public, belum
 * dipakai"). Every piece stays in the tree and the `support_*` tables are untouched, so turning it
 * back on is this one line. While off, the shopper's channel is WhatsApp (`store.whatsapp`) and the
 * /kontak page; the chat API answers 404 so nothing can write into an inbox nobody reads.
 *
 * Typed `boolean`, not the literal: both branches of every consumer keep type-checking while it is off.
 */
export const CHAT_ENABLED: boolean = false;
