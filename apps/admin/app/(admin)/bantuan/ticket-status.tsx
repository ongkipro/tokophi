import { Badge } from "@tokophi/ui/badge";

// Merchant-facing labels for a ticket's state.
export const TICKET_UI: Record<string, { label: string; cls: string }> = {
  open: { label: "Menunggu balasan", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  answered: { label: "Dibalas", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  closed: { label: "Selesai", cls: "bg-muted text-muted-foreground" },
};

export function TicketStatus({ status }: { status: string }) {
  const ui = TICKET_UI[status] ?? TICKET_UI.open;
  return <Badge variant="secondary" className={`border-transparent ${ui.cls}`}>{ui.label}</Badge>;
}
