// KiriminAja tracking — the RESPONSE SHAPE, the sorting code, and the webhook-hint binding rule.
//
// Pure (no `server-only`, no DB, no fetch) so every rule here is table-tested, and so the three
// consumers — the tracking poller, the webhook's verified pull, and the seller's "Lacak" button —
// read ONE parser instead of three hand-typed casts.
//
// 🔴 WHY THIS FILE EXISTS — MEASURED 2026-09-14. `POST /api/mitra/tracking` answers
//
//     { status, text, method: "shTracking", status_code: 105, details: { awb, sorting_code, … }, histories: [] }
//
// (their OpenAPI 3.1 schema says the same, and a live sandbox call from the allow-listed production
// container returned exactly those keys). All three consumers read `r.data` — a key the response
// has never had. So every successful pull produced `{}`: no waybill, no status, nothing. Production's
// own evidence line had been saying so for weeks — `ok=true statusType="undefined"` on every row,
// no `keys` — which is why `awbFilled` could not move no matter what the courier did.
//
// ⚠️ AND THE SANDBOX'S "WAYBILL" IS A MOCK. For every UAT parcel `details.awb` reads
// `MOCK-<our booking ref>` (e.g. `MOCK-5758-UAT1080737`) — measured on all eight. It is not our ref,
// so the old `awb !== ref` test would have ACCEPTED it, and the moment this parser went live the
// poller would have stamped it into `orders.awb` and the label would have printed a resi no courier
// can scan. `realWaybill` is the one test every consumer uses.

/** One entry of `histories[]`, reduced to what a screen can show. */
export type KaTrackingHistory = { date: string; desc: string; statusCode: number | null };

export type KaTracking = {
  /** The courier's waybill, or null. Never an empty string; the caller still compares it to the booking ref. */
  awb: string | null;
  /** Normalised sorting / routing code (`details.sorting_code`), or null. See `normalizeSortingCode`. */
  sortingCode: string | null;
  /**
   * The PACKAGE status code — the top-level `status_code` (105 = awaiting pickup, 200 = delivered …).
   * Their schema is explicit that it is "Package status field, not an HTTP status". Falls back to
   * `details.status_code`, then to the legacy text `status`. Fed to `outcomeFromTrackingCode`.
   */
  statusCode: number | string | null;
  /** The vendor's own sentence for the status ("Menunggu Pickup"). Display/evidence only — nothing maps off it. */
  text: string | null;
  histories: KaTrackingHistory[];
  /** `details` key NAMES (never values) for the poller's evidence line. */
  keys: string[];
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const code = (v: unknown): number | string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) return /^\d+$/.test(v.trim()) ? Number(v.trim()) : v.trim();
  return null;
};

/**
 * Parse a tracking response body. Accepts the documented envelope (`details`) and, defensively, the
 * `data` shape this code used to assume — a vendor that ever sends it again is still read, but the
 * `details` key always wins when both exist.
 */
export function parseKaTracking(body: unknown): KaTracking {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const pick = (k: string) => (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) ? (b[k] as Record<string, unknown>) : null);
  const details = pick("details") ?? pick("data") ?? {};
  const historiesRaw = Array.isArray(b.histories) ? b.histories : Array.isArray(details.history) ? (details.history as unknown[]) : [];
  const histories: KaTrackingHistory[] = historiesRaw
    .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
    .map((h) => {
      const c = code(h.status_code);
      return {
        date: [str(h.created_at) ?? str(h.date), str(h.time)].filter(Boolean).join(" "),
        desc: str(h.status) ?? str(h.desc) ?? str(h.description) ?? "",
        statusCode: typeof c === "number" ? c : null,
      };
    });
  return {
    awb: str(details.awb) ?? str(details.waybill),
    sortingCode: normalizeSortingCode(details.sorting_code),
    statusCode: code(b.status_code) ?? code(details.status_code) ?? code(details.status),
    text: str(b.text) ?? str(details.text) ?? str(details.status_text),
    histories,
    keys: Object.keys(details).sort(),
  };
}

/**
 * The courier-issued waybill, or null. Refuses, in one place, the three things that look like one and
 * are not: our own booking ref echoed back, a value that CONTAINS that ref (the sandbox's
 * `MOCK-<ref>`), and anything marked MOCK/DEMO/TEST. A label is printed from what this returns.
 */
export function realWaybill(awb: string | null | undefined, ref: string | null | undefined): string | null {
  const a = typeof awb === "string" ? awb.trim() : "";
  if (!a) return null;
  const r = typeof ref === "string" ? ref.trim() : "";
  if (r && (a === r || a.includes(r))) return null;
  if (/^(mock|demo|test|dummy)[-_ ]/i.test(a)) return null;
  return a;
}

// ─── Sorting code ──────────────────────────────────────────────────────────────────────────────
//
// KiriminAja (UAT review, 2026-09-14): SPX, ID Express, J&T and J&T Cargo labels MUST carry the
// sorting code, which arrives on the FIRST webhook event, `processed_packages`, and is issued only in
// production — the sandbox answers `sorting_code: null` (measured). Their own examples:
// `JOG-JOG1000-JKT2010`, `JOG-JOG1000-JKT2020`.
//
// It is printed on a parcel and a sorting hub routes on it, so a malformed value is not "better than
// nothing": a string we cannot trust is dropped, and the label shows the slot as missing instead.

/** Longest code we accept. The vendor's examples are 19 characters; 64 leaves room without inviting an essay. */
export const SORTING_CODE_MAX = 64;
// Letters, digits and the separators routing codes use. No markup, no control characters, no
// multi-line text — the value lands in a printed label and in a database column read by a sorter.
const SORTING_CODE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9 ._/:-]*[A-Za-z0-9])?$/;

/** A clean sorting code, or null for anything absent, empty, too long or outside the allowed characters. */
export function normalizeSortingCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // Only runs of ordinary SPACES collapse. A newline or tab is refused by the character class below,
  // not flattened into a space first — a multi-line value is not a routing code with bad spacing.
  const s = v.trim().replace(/ {2,}/g, " ");
  if (!s || s.length > SORTING_CODE_MAX || !SORTING_CODE_RE.test(s)) return null;
  return s;
}

/**
 * Couriers whose label MUST show a sorting code (KiriminAja, 2026-09-14): SPX, ID Express, J&T
 * Express and J&T Cargo — `orders.courier` codes `spx`, `idx`, `jnt`, `jtcargo`. A courier code, never
 * a display name; the join-key rule in `createShipment` is why `orders.courier` holds the code.
 */
export const SORTING_CODE_COURIERS = ["spx", "idx", "jnt", "jtcargo"] as const;
export function courierNeedsSortingCode(courier: string | null | undefined): boolean {
  const c = (courier ?? "").trim().toLowerCase();
  return (SORTING_CODE_COURIERS as readonly string[]).includes(c);
}

/**
 * The sorting code a WEBHOOK row may contribute — and the rule that keeps the webhook a hint.
 *
 * The receiver's standing invariant is that the body is never believed: every fact comes from a
 * verified tracking pull. The sorting code is the one field the vendor says is delivered on the
 * webhook, so it is accepted from the body ONLY when the same row's `awb` equals the waybill we
 * VERIFIED for that order (the pull just made, or the one already stored). A forger would have to
 * know the real, courier-issued waybill of a real order — at which point the code attaches to that
 * one parcel and to nothing else. No verified waybill ⇒ nothing is taken. The tracking pull's own
 * `details.sorting_code`, when present, is preferred over this by the caller.
 */
export function sortingCodeFromHint(h: { hintAwb: unknown; hintSortingCode: unknown; verifiedAwb: string | null | undefined }): string | null {
  const verified = typeof h.verifiedAwb === "string" ? h.verifiedAwb.trim() : "";
  const claimed = typeof h.hintAwb === "string" ? h.hintAwb.trim() : "";
  if (!verified || !claimed || claimed !== verified) return null;
  return normalizeSortingCode(h.hintSortingCode);
}
