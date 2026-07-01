"use client";
import { Calendar, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RANGE_OPTIONS, rangeLabel, type RangeKey } from "@/lib/data/dashboard";

export function DateRangeSwitcher({ value, onChange }: { value: RangeKey; onChange: (k: RangeKey) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" className="gap-2">
            <Calendar className="size-4 text-muted-foreground" />
            <span className="font-medium">{rangeLabel(value)}</span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Rentang Laporan</DropdownMenuLabel>
        {RANGE_OPTIONS.map((r) => (
          <DropdownMenuItem key={r.key} onClick={() => onChange(r.key)} className="justify-between">
            {r.label}
            {r.key === value && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="justify-between">
          Rentang khusus…
          <span className="text-[10px] text-muted-foreground">segera</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
