"use client";

import * as React from "react";
import { Search, ChevronDown, Check, Truck, Wallet, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ORDER_SEARCH_FIELDS, type OrderSearchField } from "@/components/admin/pesanan/order-list-types";
import { num } from "@/lib/format";

export type OrderFiltersValue = {
  field: OrderSearchField;
  q: string;
  courier: string;
  method: string;
};

export function OrderFilters({
  value,
  couriers,
  methods,
  pending,
  onApply,
  onReset,
}: {
  value: OrderFiltersValue;
  couriers: string[];
  methods: { value: string; label: string; count: number }[];
  pending: boolean;
  onApply: (next: Partial<OrderFiltersValue>) => void;
  onReset: () => void;
}) {
  // The input is the ONE piece of local state: it must feel instant while typing, but the search
  // itself runs on the server (685 orders — we never ship the table to the browser to grep it).
  // Committed on submit, so a keystroke is not a query.
  // (adjusting state during render — the React-sanctioned way to re-sync on a prop change, e.g. Reset)
  const [term, setTerm] = React.useState(value.q);
  const [seen, setSeen] = React.useState(value.q);
  if (seen !== value.q) {
    setSeen(value.q);
    setTerm(value.q);
  }

  const field = ORDER_SEARCH_FIELDS.find((f) => f.value === value.field) ?? ORDER_SEARCH_FIELDS[0];
  const activeMethod = methods.find((m) => m.value === value.method);
  const hasFilter = Boolean(value.q || value.courier || value.method);

  return (
    <div className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-center">
      {/* search: field picker + input, Shopee-style — one box, you choose what it looks in */}
      <form
        className="flex w-full min-w-0 lg:max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          onApply({ q: term });
        }}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                className="shrink-0 gap-1.5 rounded-r-none border-r-0 px-3 font-normal text-muted-foreground"
              >
                {field.label}
                <ChevronDown className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Cari berdasarkan</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ORDER_SEARCH_FIELDS.map((f) => (
              <DropdownMenuItem key={f.value} onClick={() => onApply({ field: f.value, q: term })}>
                <span className="flex-1">{f.label}</span>
                {f.value === value.field && <Check className="size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={field.placeholder}
            aria-label={field.placeholder}
            className="rounded-l-none pl-8"
          />
        </div>
        <Button type="submit" className="ml-2 shrink-0" disabled={pending}>
          Cari
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
        {/* Jasa Kirim — built from `select distinct courier from orders where courier is not null`.
            It is near-empty because almost nothing has ever been booked (`orders.courier` is null on
            699 of 700 rows). We say so, rather than padding the menu with couriers we have never
            shipped with just to make the dropdown look alive. It fills itself as bookings land. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" className="gap-2">
                <Truck className="size-4" />
                {value.courier || "Jasa Kirim"}
                <ChevronDown className="size-4 text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Jasa Kirim</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {couriers.length === 0 ? (
              <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
                Belum ada jasa kirim pada pesanan mana pun — belum satu pun pengiriman dibooking,
                jadi tidak ada yang bisa difilter.
              </p>
            ) : (
              <>
                <DropdownMenuItem onClick={() => onApply({ courier: "" })}>
                  <span className="flex-1">Semua</span>
                  {!value.courier && <Check className="size-4 text-primary" />}
                </DropdownMenuItem>
                {couriers.map((c) => (
                  <DropdownMenuItem key={c} onClick={() => onApply({ courier: c })}>
                    <span className="flex-1">{c}</span>
                    {value.courier === c && <Check className="size-4 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Metode bayar — counts are real. COD sits here at 0 on purpose: it is the filter every
            Indonesian seller reaches for, and "COD 0" is a fact worth showing, not a bug to hide. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" className="gap-2">
                <Wallet className="size-4" />
                {activeMethod ? activeMethod.label : "Metode Bayar"}
                <ChevronDown className="size-4 text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Metode Bayar</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onApply({ method: "" })}>
              <span className="flex-1">Semua</span>
              {!value.method && <Check className="size-4 text-primary" />}
            </DropdownMenuItem>
            {methods.map((m) => (
              <DropdownMenuItem key={m.value} onClick={() => onApply({ method: m.value })}>
                <span className="flex-1">{m.label}</span>
                <span className="tabular-nums text-xs text-muted-foreground">{num(m.count)}</span>
                {value.method === m.value && <Check className="size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {hasFilter && (
          <Button variant="ghost" className="gap-1.5 text-muted-foreground" onClick={onReset}>
            <X className="size-4" /> Reset
          </Button>
        )}
      </div>
    </div>
  );
}
