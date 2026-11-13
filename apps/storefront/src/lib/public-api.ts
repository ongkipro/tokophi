// The Seller app's public API, as the SHOPPER'S BROWSER calls it — and the storefront CSP built from
// the very same values. ONE place, because two copies is how CSP-CONNECT happened (2026-11-13): the
// checkout fetched `https://app.tokophi.com/api/public/{ongkir,order,promo}` while the Report-Only
// policy's `connect-src` listed only the shop's own origin — invisible until someone read the console,
// and a dead checkout (no rates → no COD → no order) the day the policy is enforced.
//
// RUNTIME env (process.env), NOT import.meta.env. `import.meta.env.PUBLIC_*` is replaced at BUILD time,
// and the Docker image is built WITHOUT env — so those bake in as `undefined` and fall back to
// `http://localhost:3000`, a host the shopper's browser cannot reach in production. Read on the server
// at module load (same pattern as `ADMIN_BASE` in data/catalog.ts and the store resolver) and handed to
// the client via `define:vars` by checkout.astro and OrderFunnel.astro.
import { storefrontCspReportOnly } from "@tokophi/lib/csp";

export const ONGKIR_API = process.env.PUBLIC_ONGKIR_API || "http://localhost:3000/api/public/ongkir";
export const ORDER_API = process.env.PUBLIC_ORDER_API || "http://localhost:3000/api/public/order";
// PROMO P0 — voucher preview. Derived from the order API base so it needs no new env (same admin host).
export const PROMO_API = ORDER_API.replace(/\/order$/, "/promo");

/** Every URL a shopper page fetches cross-origin. A new one goes HERE, or the CSP will not list it. */
export const CLIENT_API_URLS = [ONGKIR_API, ORDER_API, PROMO_API] as const;

/** The `Content-Security-Policy-Report-Only` value `middleware.ts` sets on every storefront response. */
export const STOREFRONT_CSP = storefrontCspReportOnly(CLIENT_API_URLS);
