"use server";
import { db } from "@tokophi/db";
import { revalidatePath } from "next/cache";
import { platformGate } from "@/lib/platform-auth";
import { AFFILIATE_ACCOUNT_MIN_RANK } from "@/lib/route-roles";
import { resetAffiliatePassword, setAffiliateDisabled, type DisableResult, type ResetResult } from "@/lib/affiliate-accounts";

// Super Admin → Affiliate (AFFILIATE-PW-RESET interim, ADR 0022). `platformGate` is the FIRST statement of
// each action and the boundary; the floor is the same constant the route gate reads (route-roles.ts), so
// the screen and its buttons cannot drift apart. The logic, the session revocation and the audit line
// live in `lib/affiliate-accounts.ts` and commit in ONE transaction.

/** Reset an affiliate account's password: a fresh random one, revealed ONCE in the result. */
export async function resetAffiliateAccountPassword(accountId: string): Promise<ResetResult> {
  const gate = await platformGate(AFFILIATE_ACCOUNT_MIN_RANK);
  if (!gate.ok) return gate;
  const r = await resetAffiliatePassword(db, accountId, gate.admin.email);
  revalidatePath("/affiliate");
  return r;
}

/** Disable (cannot sign in, every session revoked) or re-enable an affiliate account. */
export async function setAffiliateAccountDisabled(accountId: string, disabled: boolean): Promise<DisableResult> {
  const gate = await platformGate(AFFILIATE_ACCOUNT_MIN_RANK);
  if (!gate.ok) return gate;
  const r = await setAffiliateDisabled(db, accountId, disabled === true, gate.admin.email);
  revalidatePath("/affiliate");
  return r;
}
