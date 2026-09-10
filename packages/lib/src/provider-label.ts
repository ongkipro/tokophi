// What a MERCHANT or a SHOPPER is allowed to read where a provider brand would otherwise appear.
//
// 🔴 ADR 0004: provider brands stay hidden from clients. Only Super Admin — our own control plane —
// names KiriminAja or AutoLaris. The payment side has always obeyed this (a shopper reads "biaya
// pembayaran", never the PSP), but the SHIPPING side leaked the aggregator's name into nine strings
// a seller can read, including one written to `orders.problem_note` by the tracking cron and shown
// on the order screen. The decision was five months old; the strings were never swept.
//
// ⚠️ THIS IS A LABEL, NOT A DISGUISE. It replaces the brand in copy addressed to a client. It does
// NOT apply to: code identifiers, env var names, database columns, stored values (`provider:
// "autolaris"` is a row we read back), console/server logs, or anything rendered by
// `apps/super-admin`. Operators must see the real vendor — that is how a support call gets resolved.
//
// One constant, because the same sentence is produced in six files and a per-file string is how the
// brand crept back in the first place.
export const SHIPPING_SERVICE = "TokoΦ Kirim";

/** The payment counterpart, for symmetry — the PSP is never named to a client either. */
export const PAYMENT_SERVICE = "TokoΦ Bayar";
