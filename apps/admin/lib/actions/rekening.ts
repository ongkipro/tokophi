"use server";
import { schema } from "@tokophi/db";
import { getSession } from "@/lib/auth";
import { withCurrentTenant } from "@/lib/tenant";

// The payout bank account, read side. It lives in its own module rather than in lib/actions/ledger
// so the Pengaturan card does not have to pull in the whole payout surface — and, more practically,
// so this can be edited without colliding with work on the ledger itself.
//
// The WRITE stays in lib/actions/ledger.ts (`saveBankAccount`): one writer, so Pengaturan → Rekening
// and Saldo → Rekening can never drift into disagreeing about where a merchant's money is sent.
export type BankAccount = { bankName: string | null; bankAccount: string | null; bankHolder: string | null };

export async function getBankAccount(): Promise<BankAccount> {
  if (!(await getSession())) return { bankName: null, bankAccount: null, bankHolder: null };
  return withCurrentTenant(async (db) => {
    const [s] = await db
      .select({
        bankName: schema.storeSettings.bankName,
        bankAccount: schema.storeSettings.bankAccount,
        bankHolder: schema.storeSettings.bankHolder,
      })
      .from(schema.storeSettings)
      .limit(1);
    return {
      bankName: s?.bankName ?? null,
      bankAccount: s?.bankAccount ?? null,
      bankHolder: s?.bankHolder ?? null,
    };
  });
}

// ⚠️ Do NOT re-export saveBankAccount from here. A "use server" module may only export async
// functions it DECLARES: `export { x } from "..."` makes Turbopack reject the whole file
// ("Only async functions are allowed to be exported in a 'use server' file"), and the module then
// has NO exports at all — every import from it fails. `tsc` does not know this rule and passes
// happily; only the runtime catches it. The write stays single-sourced in lib/actions/ledger.ts;
// callers import it from there directly.
