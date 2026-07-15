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
// is knowable at build time. `cname.tokophi.com` is the documented default (it is already RESERVED in
// the storefront's host resolver).
export const CNAME_TARGET = process.env.CUSTOM_DOMAIN_CNAME_TARGET || "cname.tokophi.com";

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
