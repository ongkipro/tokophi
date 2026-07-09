import Link from "next/link";
import { NavLinks } from "./nav-links";
import { Brand } from "./brand";
import { Sparkles } from "lucide-react";
import { IDR } from "@tokophi/lib/format";
import { BILLING } from "@tokophi/lib/billing";
import { getBilling } from "@/lib/data/billing";

export async function Sidebar() {
  const bill = await getBilling();
  const blurb = !bill
    ? "Semua fitur aktif."
    : bill.status === "trial"
      ? `Uji coba gratis — ${bill.daysLeft} hari tersisa. Lanjut cuma ${IDR(BILLING.FIRST_MONTH_IDR)} bulan pertama.`
      : bill.status === "active"
        ? `Aktif — perpanjang dalam ${bill.daysLeft} hari (${IDR(bill.nextAmount)}/bln).`
        : bill.status === "past_due"
          ? `Menunggu pembayaran ${IDR(bill.nextAmount)} — ${bill.daysLeft} hari sebelum ditangguhkan.`
          : `Ditangguhkan — bayar ${IDR(bill.nextAmount)} untuk aktifkan lagi.`;
  const accent =
    bill?.status === "past_due" ? "from-orange-500/10 to-orange-500/5" : bill?.status === "suspended" ? "from-destructive/10 to-destructive/5" : "from-primary/10 to-primary/5";
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-card lg:flex">
      <div className="flex h-16 items-center border-b px-5">
        <Brand />
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <NavLinks />
      </div>
      <div className="p-3">
        <Link href="/akun/langganan" className={`block rounded-xl border bg-gradient-to-br ${accent} p-4 transition-opacity hover:opacity-90`}>
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" /> Langganan {BILLING.PLAN_NAME}
          </div>
          <p className="text-xs text-muted-foreground">{blurb}</p>
        </Link>
      </div>
    </aside>
  );
}
