/**
 * Escape a user-typed string so it is matched LITERALLY inside a SQL `LIKE`/`ILIKE` pattern.
 *
 * This is NOT about injection — every call site passes the result as a bound parameter, so a quote
 * was never dangerous. It is about `%` and `_` being WILDCARDS in a LIKE pattern while the person
 * typing them is using a search box:
 *
 *   · a lone `%` matches every row — measured on the dev DB, `number ilike '%'||'%'||'%'` returned
 *     **all 842 orders**, which reads as "the search is broken", not as "you typed a wildcard";
 *   · `_` matches any single character, so searching the literal resi `SPX_123` also returns
 *     `SPX0123` and `SPXA123` — the wrong parcel, silently, with a plausible-looking result list.
 *
 * `\` must be escaped FIRST or it would escape the escapes we are about to add. Postgres treats `\`
 * as LIKE's escape character by default, so no `ESCAPE` clause is needed.
 *
 * Written as one shared helper because the identical regex had already been hand-written twice
 * (`lib/data/areas.ts`, `lib/data/orders.ts`) and a third site (`lib/actions/taxonomy.ts`) had
 * simply been missed — which is the usual outcome when a rule lives in a comment instead of a
 * function.
 */
export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** `likeEscape` wrapped in `%…%` — the "contains" pattern, which is what nearly every caller wants. */
export const likeContains = (s: string): string => `%${likeEscape(s)}%`;
