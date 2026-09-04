import { clearsRank, type PlatformRole } from "./platform-rank";

/**
 * THE MINIMUM OPERATOR RANK PER PROTECTED ROUTE GROUP (Task 5.17 / SEC-9).
 *
 * 🔴 WHAT THIS EXISTS TO FIX. Every super-admin MUTATION has been rank-gated since 2026-07-15
 * (`platformGate(min)`, 33 call sites) — but the SCREENS were not. `middleware.ts` proves that a
 * platform session cookie exists and nothing more, and the layout proves the operator row still
 * exists; neither has ever compared a rank. So a `support` operator who typed `/pencairan` was
 * served the payout queue in full: every merchant's bank name, account number and account holder,
 * every pending amount, the platform's float. The buttons refused, and that is the boundary working
 * — but the DATA had already been read, rendered and sent. Hiding a nav item is not enforcement.
 *
 * ⚠️ ROUTE CHECKS ARE ADDITIVE, NEVER A REPLACEMENT. `platformGate(min)` inside each action stays
 * exactly as it is and remains the mutation boundary: a route check cannot see a POST to a server
 * action, and an action reachable from two screens must carry its own floor. This layer answers a
 * different question — "may this operator LOAD this screen's data at all?".
 *
 * ⚠️ AND THE FLOOR IS THE LOWEST RANK THAT CAN USE THE SCREEN, NOT THE HIGHEST. `/pengaturan` hosts
 * both `admin`-rank actions (couriers, payment channels, connection tests) and `owner`-rank ones
 * (inviting an operator). Its floor is therefore `admin`; the owner-only affordances keep refusing
 * at their own gate, the way they already do. Setting a route floor above an action it hosts would
 * lock out the operator that action was written for.
 *
 * WHY THE RANK CANNOT COME FROM THE MIDDLEWARE, AND WHY IT IS NOT IN THE COOKIE. Middleware runs on
 * the EDGE and cannot reach Postgres, and the control plane's standing rule is that rank comes from
 * `platform_admins` on every request — putting it in the JWT would hand every operator a rank they
 * minted for themselves at login and keep for seven days. So the enforcement point is the page
 * itself, above its first data read.
 */

export type RouteRule = {
  /** Path prefix, matched as `p === prefix || p.startsWith(prefix + "/")`. `/` is exact-only. */
  prefix: string;
  min: PlatformRole;
  /** Why this floor — read by whoever next argues the policy, and by the operator's denial screen. */
  why: string;
};

/**
 * Longest prefix wins, so `/toko/[id]` inherits `/toko` without an entry of its own.
 *
 * THE POLICY IN ONE LINE: **the support desk and the context of ONE store are `support`; anything
 * platform-wide about money or configuration is `admin`.** It follows the roles as
 * `platform-auth.ts` already defines them — *support: reads, works the ticket queue; cannot touch
 * money, credentials, or a merchant's shop*.
 *
 * ⚠️ THE LINE IS "PLATFORM-WIDE", NOT "ANY RUPIAH", AND THAT IS DELIBERATE. `/toko/[id]` shows one
 * merchant's own balance, invoices and payouts, and a support operator answering *"where is my
 * withdrawal?"* needs exactly that. What they do not get is the CROSS-MERCHANT book: the payout
 * queue with every bank account in it, the invoice ledger, platform revenue, the operator roster.
 * A policy drawn any other way leaks by the back door — which is why `/` is `admin` too: the
 * dashboard is MRR, collected revenue, merchant float and the six most recent invoices, i.e. the
 * same figures `/paket` and `/analitik` are gated for. A summary of privileged data is privileged.
 *
 * ⚠️ ORDER MATTERS: `landingForRole` returns the first rule a rank clears, so the list is written
 * support-desk first. Losing that order silently moves where a refused operator is sent.
 */
export const ROUTE_RULES: RouteRule[] = [
  { prefix: "/tiket", min: "support", why: "Antrean dukungan: pekerjaan inti peran support." },
  { prefix: "/toko", min: "support", why: "Konteks satu toko untuk menjawab tiketnya — termasuk saldo toko itu sendiri." },
  { prefix: "/update-log", min: "support", why: "Catatan rilis — tidak ada data merchant di sini." },
  { prefix: "/", min: "admin", why: "Ringkasan uang platform: MRR, pendapatan diterima, saldo merchant, tagihan terbaru." },
  { prefix: "/paket", min: "admin", why: "Tagihan langganan dan status pembayaran seluruh merchant." },
  { prefix: "/pencairan", min: "admin", why: "Uang merchant: nomor rekening, nominal, dan persetujuan transfer." },
  { prefix: "/analitik", min: "admin", why: "Pendapatan platform dan kesehatan infrastruktur." },
  { prefix: "/pengaturan", min: "admin", why: "Konfigurasi platform dan daftar operator." },
  { prefix: "/log-sistem", min: "admin", why: "Jejak tindakan operator di SEMUA toko — reset password, suspend, VIP, konfigurasi platform. Bukan konteks satu toko: itu ada di halaman toko." },
];

/**
 * The floor for `path`. An UNLISTED path is `owner` — fail closed, the same way an unknown role
 * scores 0 in `platform-rank.ts`. A new screen therefore starts out reachable by nobody but the
 * owner rather than by everybody, and `route-roles.test.ts` derives the route list from the
 * DIRECTORY so it cannot stay unlisted for long.
 */
export function minRoleForPath(path: string): PlatformRole {
  const p = normalise(path);
  let best: RouteRule | null = null;
  for (const rule of ROUTE_RULES) {
    if (!matches(p, rule.prefix)) continue;
    if (!best || rule.prefix.length > best.prefix.length) best = rule;
  }
  return best?.min ?? "owner";
}

/** The sentence explaining the floor, for the denial screen. Empty when the path is unlisted. */
export function reasonForPath(path: string): string {
  const p = normalise(path);
  let best: RouteRule | null = null;
  for (const rule of ROUTE_RULES) {
    if (!matches(p, rule.prefix)) continue;
    if (!best || rule.prefix.length > best.prefix.length) best = rule;
  }
  return best?.why ?? "Halaman ini belum diberi peran minimum — akses dibatasi ke owner.";
}

/** May an operator holding `role` LOAD `path`? The one comparison every protected page makes. */
export const canOpenPath = (role: string | undefined, path: string): boolean =>
  clearsRank(role, minRoleForPath(path));

/**
 * Where an operator goes when they cannot open where they were going — the first route their rank
 * clears, in the order `ROUTE_RULES` is written. `support` therefore has a working control plane
 * (the ticket queue) instead of a wall, and it is what the dashboard forwards them to on login.
 */
export function landingForRole(role: string | undefined): string {
  return ROUTE_RULES.find((r) => clearsRank(role, r.min))?.prefix ?? "/";
}

function normalise(path: string): string {
  const clean = (path.split("?")[0] ?? "").replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
}

const matches = (path: string, prefix: string): boolean =>
  prefix === "/" ? path === "/" : path === prefix || path.startsWith(`${prefix}/`);
