import Link from "next/link";
import {
  MessagesSquare,
  Clock,
  Wallet,
  Trophy,
  Send,
  ArrowRight,
  ShoppingCart,
  CreditCard,
  Star,
  Repeat,
  CheckCircle2,
  BadgeCheck,
} from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Separator } from "@tokophi/ui/separator";
import { IDR, num, waLink, fillTemplate } from "@tokophi/lib/format";
import { type FollowupType, type LeadStage } from "@/lib/mock/store";
import { getLeads, getFollowups, getWaTemplates } from "@/lib/data/crm";
import { getStoreName } from "@/lib/data/store";
import { getSession } from "@/lib/auth";
import { cn } from "@tokophi/ui/lib/utils";


// ---- follow-up type presentation ----
const FU_META: Record<
  FollowupType,
  { label: string; icon: typeof ShoppingCart; cls: string }
> = {
  keranjang: {
    label: "Keranjang",
    icon: ShoppingCart,
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  },
  pembayaran: {
    label: "Pembayaran",
    icon: CreditCard,
    cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  },
  konfirmasi: {
    label: "Konfirmasi",
    icon: CheckCircle2,
    cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
  },
  pascabeli: {
    label: "Pasca-beli",
    icon: BadgeCheck,
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  repeat: {
    label: "Repeat",
    icon: Repeat,
    cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400",
  },
  ulasan: {
    label: "Ulasan",
    icon: Star,
    cls: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
  },
};

// ---- pipeline stage presentation ----
const STAGE_ORDER: LeadStage[] = ["baru", "dihubungi", "nego", "closing", "menang"];
const STAGE_LABEL: Record<LeadStage, string> = {
  baru: "Baru",
  dihubungi: "Dihubungi",
  nego: "Nego",
  closing: "Closing",
  menang: "Menang",
  kalah: "Kalah",
};
const STAGE_BAR: Record<string, string> = {
  baru: "bg-slate-400",
  dihubungi: "bg-sky-500",
  nego: "bg-amber-500",
  closing: "bg-indigo-500",
  menang: "bg-emerald-500",
};

function dueLabel(dueDays: number) {
  if (dueDays === 0) return { text: "Hari ini", late: false };
  if (dueDays < 0) return { text: `Telat ${Math.abs(dueDays)} hari`, late: true };
  return { text: `${dueDays} hari lagi`, late: false };
}

export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const session = await getSession();
  const [LEADS, FOLLOWUPS, WA_TEMPLATES, storeName] = await Promise.all([
    getLeads(),
    getFollowups(),
    getWaTemplates(),
    session ? getStoreName(session.storeId) : Promise.resolve("Toko"),
  ]);
  // ---- derived data ----
  const dueToday = FOLLOWUPS.filter(
    (f) => f.dueDays <= 0 && f.status === "menunggu",
  ).sort((a, b) => a.dueDays - b.dueDays);

  const activeLeads = LEADS.filter(
    (l) => l.stage !== "menang" && l.stage !== "kalah",
  );
  const pipelineValue = activeLeads.reduce((a, l) => a + l.value_idr, 0);
  const wonThisMonth = LEADS.filter((l) => l.stage === "menang").length;

  const stats = [
    {
      label: "Perlu follow-up hari ini",
      value: num(dueToday.length),
      icon: Clock,
      iconCls:
        "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
      hint: "menunggu dikirim",
    },
    {
      label: "Prospek aktif",
      value: num(activeLeads.length),
      icon: MessagesSquare,
      iconCls: "bg-muted text-muted-foreground",
      hint: "belum menang/kalah",
    },
    {
      label: "Nilai pipeline",
      value: IDR(pipelineValue, { compact: true }),
      icon: Wallet,
      iconCls: "bg-muted text-muted-foreground",
      hint: "estimasi prospek aktif",
    },
    {
      label: "Menang bulan ini",
      value: num(wonThisMonth),
      icon: Trophy,
      iconCls:
        "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
      hint: "prospek jadi pembeli",
    },
  ];

  // ---- pipeline funnel aggregates ----
  const funnel = STAGE_ORDER.map((stage) => {
    const rows = LEADS.filter((l) => l.stage === stage);
    return {
      stage,
      label: STAGE_LABEL[stage],
      count: rows.length,
      value: rows.reduce((a, l) => a + l.value_idr, 0),
    };
  });
  const maxCount = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        title="CRM"
        desc="Kelola prospek dan follow-up pelanggan lewat WhatsApp."
      >
        <Button
          nativeButton={false}
          className="gap-2"
          render={<Link href="/crm/followup" />}
        >
          <Send className="size-4" /> Mulai follow-up
        </Button>
      </PageHeader>

      {/* stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="gap-0 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                {s.label}
              </span>
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg",
                  s.iconCls,
                )}
              >
                <s.icon className="size-4" />
              </span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums">
              {s.value}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{s.hint}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* follow-up today */}
        <Card className="gap-0 py-0 lg:col-span-3">
          <div className="flex items-center justify-between p-4">
            <div>
              <h2 className="text-base font-medium">
                Perlu follow-up hari ini
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Prospek yang menunggu dihubungi.
              </p>
            </div>
            <Badge variant="secondary" className="tabular-nums">
              {num(dueToday.length)}
            </Badge>
          </div>
          <Separator />

          {dueToday.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                <CheckCircle2 className="size-5" />
              </span>
              <p className="text-sm font-medium">Semua sudah ditindaklanjuti</p>
              <p className="text-xs text-muted-foreground">
                Tidak ada follow-up yang tertunda hari ini. 🎉
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {dueToday.slice(0, 5).map((f) => {
                const meta = FU_META[f.type];
                const due = dueLabel(f.dueDays);
                const tpl =
                  WA_TEMPLATES.find((t) => t.type === f.type) ?? WA_TEMPLATES[0];
                // `link: ""` — see `followup-client.tsx`. A follow-up row carries no checkout
                // session, so no recovery link exists here; without this an unknown `{{link}}` would
                // go out to a customer verbatim.
                const message = fillTemplate(tpl.body, {
                  nama: f.customer,
                  produk: f.context,
                  no_pesanan: f.context,
                  toko: storeName ?? "Toko",
                  link: "",
                });
                return (
                  <li
                    key={f.id}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg",
                        meta.cls,
                      )}
                    >
                      <meta.icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-sm font-medium">
                          {f.customer}
                        </span>
                        <Badge
                          variant="secondary"
                          className={cn("border-transparent", meta.cls)}
                        >
                          {meta.label}
                        </Badge>
                        <span
                          className={cn(
                            "text-xs tabular-nums",
                            due.late
                              ? "font-medium text-rose-600 dark:text-rose-400"
                              : "text-muted-foreground",
                          )}
                        >
                          {due.text}
                        </span>
                      </div>
                      {/* The context line carries the invoice number, its amount, or a day count —
                          30,95px of ink movement per row at 1440px, down a queue of follow-ups. */}
                      <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
                        {f.context}
                      </p>
                    </div>
                    <Button
                      nativeButton={false}
                      size="sm"
                      className="shrink-0 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                      render={
                        <a
                          href={waLink(f.phone, message)}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                    >
                      <Send className="size-3.5" /> Kirim WA
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          {dueToday.length > 0 && (
            <>
              <Separator />
              <div className="p-3">
                <Button
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-center gap-1.5 text-muted-foreground"
                  render={<Link href="/crm/followup" />}
                >
                  Lihat semua follow-up <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </>
          )}
        </Card>

        {/* pipeline summary */}
        <Card className="gap-0 py-0 lg:col-span-2">
          <div className="p-4">
            <h2 className="text-base font-medium">Pipeline ringkas</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Sebaran prospek per tahap.
            </p>
          </div>
          <Separator />

          <div className="space-y-4 p-4">
            {funnel.map((f) => (
              <div key={f.stage}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">{f.label}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {num(f.count)} prospek
                    </span>
                  </div>
                  <span className="text-xs font-medium tabular-nums">
                    {IDR(f.value, { compact: true })}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      STAGE_BAR[f.stage],
                    )}
                    style={{
                      width: `${Math.max(6, (f.count / maxCount) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <Separator />
          <div className="p-3">
            <Button
              nativeButton={false}
              variant="ghost"
              size="sm"
              className="w-full justify-center gap-1.5 text-muted-foreground"
              render={<Link href="/crm/pipeline" />}
            >
              Lihat pipeline <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
