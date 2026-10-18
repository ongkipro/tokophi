// One lock for "this account is mine to write to". Every write that attaches a row to a buyer account
// (claim, address, join, accept an invitation) and the closure itself take it, so they serialise on the
// account row: a write that meets a closure either finishes first (and the closure then sweeps its rows)
// or waits, sees `closed`, and is refused. Without it a request that passed the session check a moment
// before closure could insert a link, address or affiliate binding against an account that no longer exists.
import { sql } from "drizzle-orm";
import type { Db } from "./account";

/** Lock the account row FOR UPDATE; true only when the account is `active`. Call inside a transaction. */
export async function lockActiveAccount(tx: Db, buyerId: string): Promise<boolean> {
  const rows = (await tx.execute(sql`select status from buyer_accounts where id = ${buyerId} for update`)) as unknown as { status: string }[];
  return rows[0]?.status === "active";
}
