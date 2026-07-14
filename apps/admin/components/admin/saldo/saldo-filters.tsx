"use client";
import * as React from "react";
import { Calendar, Check, ChevronDown, Download, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@tokophi/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tokophi/ui/dropdown-menu";
import { exportCsv } from "@/lib/csv";
import { fetchExportRows } from "@/lib/actions/ledger";
import type { LedgerFilters } from "@/lib/data/ledger";
import { LEDGER_STATUS_LABEL, type LedgerStatus, type SaldoTab } from "./ledger-ui";
import { useSaldoUrl } from "./use-saldo-url";

// `new Date()` here is fine and deliberate: it only ever runs inside a click handler, never in a
// render path, so SSR and the client still agree on the markup.
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const back = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return ymd(d);
};

const PRESETS: { label: string; range: () => { dari?: string; sampai?: string } }[] = [
  { label: "7 hari terakhir", range: () => ({ dari: back(6), sampai: ymd(new Date()) }) },
  { label: "30 hari terakhir", range: () => ({ dari: back(29), sampai: ymd(new Date()) }) },
  { label: "90 hari terakhir", range: () => ({ dari: back(89), sampai: ymd(new Date()) }) },
  {
    label: "Bulan ini",
    range: () => {
      const n = new Date();
      return { dari: ymd(new Date(n.getFullYear(), n.getMonth(), 1)), sampai: ymd(n) };
    },
  },
  {
    label: "Bulan lalu",
    range: () => {
      const n = new Date();
      return {
        dari: ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
        sampai: ymd(new Date(n.getFullYear(), n.getMonth(), 0)),
      };
    },
  },
];

const STATUSES: LedgerStatus[] = ["semua", "proses", "belum", "ditarik"];

/**
 * A NATIVE <input type="date"> — deliberately not the shared <Input>, and deliberately
 * `suppressHydrationWarning`. Both need justifying, because both look like shortcuts.
 *
 * Not <Input>: the house rule bans the Base UI `Select`, and a date range is exactly the kind of
 * picker that tempts you into one. The native control needs no JS, is keyboard- and
 * screen-reader-accessible for free, and gives Indonesian users their own locale's date UI. It just
 * borrows the shared input's classes so it sits in the toolbar like everything else.
 *
 * suppressHydrationWarning: Chromium puts an inline `caret-color: transparent` on an EMPTY date
 * input before React hydrates and removes it again afterwards — the server HTML provably never
 * contains it (`curl` the page and grep) and the settled DOM has no `style` attribute at all, but
 * React samples the DOM mid-flight and reports a mismatch it cannot patch. This is the browser
 * touching the node outside React, which is precisely what the flag is for. It is scoped to this
 * one element, so it cannot mask a real mismatch anywhere else on the page.
 */
function DateInput({
  label,
  value,
  min,
  max,
  onPick,
}: {
  label: string;
  value?: string;
  min?: string;
  max?: string;
  onPick: (v: string | undefined) => void;
}) {
  return (
    <input
      type="date"
      aria-label={label}
      value={value ?? ""}
      min={min}
      max={max}
      onChange={(e) => onPick(e.target.value || undefined)}
      suppressHydrationWarning
      className="h-8 w-[9.5rem] rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm tabular-nums outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
    />
  );
}

const CSV_NAME: Record<SaldoTab, string> = {
  mutasi: "mutasi-saldo",
  proses: "dana-dalam-proses",
  penarikan: "penarikan-saldo",
};

/**
 * Periode + status, applied SERVER-SIDE (they go into the URL → into the SQL `where`). A filter that
 * only trimmed the 20 rows currently on screen would be worse than no filter at all: it would look
 * like it worked and quietly hide the other 600 matches.
 */
export function SaldoFilters({
  tab,
  filters,
  total,
}: {
  tab: SaldoTab;
  filters: LedgerFilters;
  /** rows matching the current filters, across every page */
  total: number;
}) {
  const { filter } = useSaldoUrl();
  const [busy, start] = React.useTransition();

  const status = filters.status ?? "semua";
  const active = !!filters.from || !!filters.to || status !== "semua";

  const download = () =>
    start(async () => {
      try {
        const rows = await fetchExportRows(tab, {
          from: filters.from,
          to: filters.to,
          status: filters.status,
        });
        if (!rows.length) {
          toast.error("Tidak ada baris untuk diekspor.");
          return;
        }
        const period = filters.from || filters.to ? `-${filters.from ?? "awal"}_${filters.to ?? "kini"}` : "";
        exportCsv(`${CSV_NAME[tab]}${period}`, rows);
        toast.success(`${rows.length} baris diekspor.`);
      } catch {
        toast.error("Gagal mengekspor CSV.");
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="gap-2">
              <Calendar className="size-4 text-muted-foreground" />
              Periode
              <ChevronDown className="size-4 text-muted-foreground" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuLabel>Rentang cepat</DropdownMenuLabel>
          {PRESETS.map((p) => (
            <DropdownMenuItem key={p.label} onClick={() => filter(p.range())}>
              {p.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => filter({ dari: undefined, sampai: undefined })}>
            Semua waktu
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-center gap-1.5">
        <DateInput
          label="Dari tanggal"
          value={filters.from}
          max={filters.to}
          onPick={(v) => filter({ dari: v })}
        />
        <span className="text-xs text-muted-foreground">s/d</span>
        <DateInput
          label="Sampai tanggal"
          value={filters.to}
          min={filters.from}
          onPick={(v) => filter({ sampai: v })}
        />
      </div>

      {/* Status is a property of a LEDGER MOVEMENT, so it is only offered where it means something.
          "Dana dalam proses" is already the `pending` slice by definition, and a payout carries its
          own lifecycle (menunggu/diproses/selesai) — offering this control there would be a dead
          knob the merchant learns to distrust. */}
      {tab === "mutasi" && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="gap-2">
                <span className="text-muted-foreground">Status:</span>
                <span className="font-medium">{LEDGER_STATUS_LABEL[status]}</span>
                <ChevronDown className="size-4 text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-48">
            {STATUSES.map((s) => (
              <DropdownMenuItem key={s} onClick={() => filter({ status: s === "semua" ? undefined : s })} className="justify-between">
                {LEDGER_STATUS_LABEL[s]}
                {s === status && <Check className="size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {active && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={() => filter({ dari: undefined, sampai: undefined, status: undefined })}
        >
          <X className="size-3.5" /> Reset
        </Button>
      )}

      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">{total} baris</span>
        {/* Exports the whole FILTERED set, not the visible page. */}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={download} disabled={busy || total === 0}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Ekspor CSV
        </Button>
      </div>
    </div>
  );
}
