"use client";
import { Printer } from "lucide-react";
import { Button } from "@tokophi/ui/button";

export function PrintButton() {
  return (
    <Button className="gap-2 print:hidden" onClick={() => window.print()}>
      <Printer className="size-4" /> Cetak / Simpan PDF
    </Button>
  );
}
