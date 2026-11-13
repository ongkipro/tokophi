import "server-only";
import { db, schema } from "@tokophi/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { getProviderConfig, type ProviderEnv, type ShippingProvider } from "@tokophi/lib/provider-config";
import { isShippingProvider } from "./store-shipping-provider";

// ADR 0019 — reads for the store's shipping provider and the signup codes. OWNER pool (the control plane
// reaches every tenant); every statement filters on the id it is about.

export type StoreShipping = {
  /** stores.shipping_provider — what Super Admin (or the signup code) set. */
  provider: ShippingProvider;
  /** stores.signup_code — the code it signed up with, if any. */
  signupCode: string | null;
  /** The platform master switch: 'kiriminaja' = Mengantar off for every store. */
  platformSwitch: ShippingProvider;
  /** store_mengantar_accounts.state in the active env (`none` = no row). */
  accountState: string;
  accountEnv: ProviderEnv;
};

/** The store page's "Penyedia pengiriman" card. */
export async function getStoreShipping(storeId: string): Promise<StoreShipping | null> {
  const cfg = await getProviderConfig();
  const [row] = await db
    .select({ provider: schema.stores.shippingProvider, signupCode: schema.stores.signupCode, accountState: schema.storeMengantarAccounts.state })
    .from(schema.stores)
    .leftJoin(
      schema.storeMengantarAccounts,
      and(eq(schema.storeMengantarAccounts.storeId, schema.stores.id), eq(schema.storeMengantarAccounts.env, cfg.mengantar.env)),
    )
    .where(eq(schema.stores.id, storeId))
    .limit(1);
  if (!row) return null;
  return {
    provider: isShippingProvider(row.provider) ? row.provider : "kiriminaja",
    signupCode: row.signupCode,
    platformSwitch: cfg.shipping,
    accountState: row.accountState ?? "none",
    accountEnv: cfg.mengantar.env,
  };
}

export type SignupCodeRow = {
  code: string;
  provider: ShippingProvider;
  /** ADR 0020 — IDR off a store's first paid subscription invoice (0 = provider-only code). */
  discountIdr: number;
  active: boolean;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
  /** DERIVED from `stores.signup_code` — never a counter that can drift. */
  used: number;
};

/** Every signup code, newest first, with its usage count (`signup_codes` has RLS with no policy: owner pool only). */
export async function listSignupCodes(): Promise<SignupCodeRow[]> {
  const rows = await db
    .select({
      code: schema.signupCodes.code,
      provider: schema.signupCodes.shippingProvider,
      discountIdr: schema.signupCodes.discountFirstInvoiceIdr,
      active: schema.signupCodes.active,
      note: schema.signupCodes.note,
      createdBy: schema.platformAdmins.email,
      createdAt: schema.signupCodes.createdAt,
      // Qualified BY NAME: drizzle renders an interpolated column unqualified inside a `sql` template, and in
      // a correlated subquery the inner scope would win (correlated-subquery-scoping.test.ts).
      used: sql<number>`(select count(*)::int from stores s where s.signup_code = "signup_codes"."code")`,
    })
    .from(schema.signupCodes)
    .leftJoin(schema.platformAdmins, eq(schema.platformAdmins.id, schema.signupCodes.createdBy))
    .orderBy(desc(schema.signupCodes.createdAt));
  return rows.map((r) => ({
    ...r,
    provider: isShippingProvider(r.provider) ? r.provider : "kiriminaja",
    createdAt: new Date(r.createdAt),
    used: Number(r.used),
    discountIdr: Number(r.discountIdr),
  }));
}
