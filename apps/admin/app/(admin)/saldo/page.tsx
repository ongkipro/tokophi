import { getBalance, getPendingFunds, getMovements, getPayouts, getPayoutContext } from "@/lib/data/ledger";
import { SaldoClient } from "./saldo-client";

export const dynamic = "force-dynamic";

export default async function SaldoPage() {
  const [balance, pending, movements, payouts, ctx] = await Promise.all([
    getBalance(),
    getPendingFunds(),
    getMovements(),
    getPayouts(),
    getPayoutContext(),
  ]);

  return (
    <SaldoClient balance={balance} pending={pending} movements={movements} payouts={payouts} ctx={ctx} />
  );
}
