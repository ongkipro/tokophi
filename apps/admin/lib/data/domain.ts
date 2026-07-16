import "server-only";
import { schema } from "@tokophi/db";
import { asc } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";

// Custom-domain reads for the seller dashboard (Pengaturan → Domain). CUSTOM_DOMAIN.md.
//
// RLS (migration 0050) isolates `store_domains` by store_id under the `tokophi_app` role —
// withCurrentTenant sets the GUC and drops the role, so the DB is the tenant boundary, not a
// hand-written `where store_id = …`. The verification_token is NOT returned to the client here: the
// UI shows the TXT record built from it (getDomainRecords), but the raw token is a capability the
// browser has no reason to hold.

export type StoreDomainRow = {
  id: string;
  host: string;
  status: "pending" | "verifying" | "provisioning" | "active" | "error" | "disabled";
  isPrimary: boolean;
  lastError: string | null;
  // the TXT record the merchant must publish, derived from the token (never the token itself)
  txtName: string;
  txtValue: string;
};

// The CNAME target and the base domain both come from env — this is a multi-tenant deploy and neither
// is knowable at build time. Defaults match production (storefronts on tokophi.id, custom hostnames
// forwarded through cname.tokophi.cc via Cloudflare-for-SaaS).
export const CNAME_TARGET = process.env.CUSTOM_DOMAIN_CNAME_TARGET || "cname.tokophi.cc";
export const BASE_DOMAIN = (process.env.STOREFRONT_BASE_DOMAIN || "tokophi.id").toLowerCase();

// Platform-owned zones a merchant may NEVER attach as a "custom" domain: the storefront base
// (tokophi.id), the platform surfaces (tokophi.com → app./rich./landing), and the Cloudflare-for-SaaS
// fallback zone (tokophi.cc). Blocking the whole set — not just the base — stops a merchant from
// squatting `app.tokophi.com`, `cname.tokophi.cc`, or another store's `<slug>.tokophi.id`. Kept here so
// the rule lives in ONE place next to the domains it protects.
export const PLATFORM_ZONES = Array.from(
  new Set([BASE_DOMAIN, "tokophi.id", "tokophi.com", "tokophi.cc"]),
);

// A store attaches AT MOST its root/apex domain + the `www.` of it — like Shopify's primary+redirect
// pair. Not a free-for-all: one `www` host and one non-`www` (root) host, full stop. `domainKind`
// classifies which slot a host wants; `addDomain` rejects a second host of the same kind.
export type DomainKind = "root" | "www";
export function domainKind(host: string): DomainKind {
  return /^www\./i.test(host) ? "www" : "root";
}
// A domain whose ownership is already proven (cert provisioning or live) is LOCKED — the merchant
// can't quietly detach it. Changing it goes through a support ticket to the platform (admin/super).
export const LOCKED_STATUSES = ["provisioning", "active"] as const;
export function isLockedStatus(status: StoreDomainRow["status"]): boolean {
  return (LOCKED_STATUSES as readonly string[]).includes(status);
}

/** The always-on, system-assigned storefront address `<slug>.<base>` (e.g. batik-nusantara.tokophi.id).
 *  Not a store_domains row — it is DERIVED from the store slug, and the merchant can never change it. */
export function systemDomainFor(slug: string): string {
  return `${slug}.${BASE_DOMAIN}`;
}

/** The DNS records a merchant copies. Kept in one place so the card and the verifier never disagree. */
export function domainRecords(host: string, token: string) {
  return {
    cnameName: host,
    cnameTarget: CNAME_TARGET,
    txtName: `_tokophi-verify.${host}`,
    txtValue: `tokophi-verify=${token}`,
  };
}

export async function getStoreDomains(): Promise<StoreDomainRow[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db
      .select({
        id: schema.storeDomains.id,
        host: schema.storeDomains.host,
        status: schema.storeDomains.status,
        isPrimary: schema.storeDomains.isPrimary,
        lastError: schema.storeDomains.lastError,
        token: schema.storeDomains.verificationToken,
      })
      .from(schema.storeDomains)
      .orderBy(asc(schema.storeDomains.createdAt));

    return rows.map((r) => {
      const rec = domainRecords(r.host, r.token);
      return {
        id: r.id,
        host: r.host,
        status: r.status,
        isPrimary: r.isPrimary,
        lastError: r.lastError,
        txtName: rec.txtName,
        txtValue: rec.txtValue,
      };
    });
  });
}
