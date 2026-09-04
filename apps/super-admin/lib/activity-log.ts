/**
 * The QUERY DECISION for `/log-sistem` — PURE. No React, no `@tokophi/db`.
 *
 * Same split as `route-roles.ts` and `list-page.ts`: the part that turns a URL into a database
 * question lives where a test can import it. Two of these decisions are the class AGENTS.md keeps
 * finding: "Validate every URL parameter that reaches an enum cast" (`/pesanan?bayar=<anything>`
 * was a 500), and `isUuid` before `eq(table.id, segment)` (Postgres throws `22P02` on a non-UUID).
 * `?kind=` reaches `platform_activity.kind`, an enum; `?toko=` reaches `platform_activity.store_id`,
 * a uuid. Both are whitelisted here, and a value that is not on the list is treated as "no filter"
 * rather than as an error — an operator editing the URL by hand should get the whole log, not a
 * digest.
 */

/** Mirrors `platformActivityKind` in `packages/db/src/schema.ts`; `activity-log.test.ts` pins it. */
export const ACTIVITY_KINDS = ["admin", "payment", "signup", "upgrade", "churn", "support"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  admin: "Tindakan operator",
  payment: "Pembayaran",
  signup: "Pendaftaran",
  upgrade: "Upgrade",
  churn: "Churn",
  support: "Support",
};

/** 25 rows per page: one line each, denser than `/update-log`'s paragraphs. */
export const LOG_PAGE_SIZE = 25;
/** A search string longer than this is truncated, not refused — it feeds a `LIKE`, nothing else. */
const MAX_QUERY = 120;

export type LogQuery = {
  kind: ActivityKind | null;
  storeId: string | null;
  q: string;
  page: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/** URL → query. Never throws; an unknown value on any parameter means "no filter". */
export function parseLogQuery(params: RawParams): LogQuery {
  const kind = first(params.kind);
  const toko = first(params.toko);
  const pageRaw = Number.parseInt(first(params.page), 10);
  return {
    kind: (ACTIVITY_KINDS as readonly string[]).includes(kind) ? (kind as ActivityKind) : null,
    storeId: UUID.test(toko) ? toko.toLowerCase() : null,
    q: first(params.q).trim().slice(0, MAX_QUERY),
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
  };
}

/** Query → `href`, with the page overridable — so every pagination link keeps the filters. */
export function logHref(query: LogQuery, page: number = query.page): string {
  const sp = new URLSearchParams();
  if (query.kind) sp.set("kind", query.kind);
  if (query.storeId) sp.set("toko", query.storeId);
  if (query.q) sp.set("q", query.q);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `/log-sistem?${qs}` : "/log-sistem";
}

/**
 * Which page numbers to render: first, last, and the current page's neighbours. `total` is the row
 * count so the page count is derived from the DATABASE, never from the slice on screen.
 */
export function logPages(total: number, page: number, size: number = LOG_PAGE_SIZE): { pageCount: number; page: number; numbers: number[] } {
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, size)));
  const current = Math.min(Math.max(1, page), pageCount);
  const numbers = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (n) => n === 1 || n === pageCount || Math.abs(n - current) <= 1,
  );
  return { pageCount, page: current, numbers };
}
