import { Badge } from "@tokophi/ui/badge";
import { cn } from "@tokophi/ui/lib/utils";

// Punya akun, atau tidak (`customers.registered_at`).
//
// "Tamu" is NOT an error state and must never look like one: buying here never requires an account,
// deliberately — a registration wall in front of an Indonesian checkout loses the sale. So Tamu gets
// a neutral, quiet badge (the normal case) and Terdaftar gets the accent (the extra).
export function AccountBadge({ registered, className }: { registered: boolean; className?: string }) {
  return registered ? (
    <Badge
      variant="secondary"
      className={cn("border-0 bg-indigo-500/12 font-medium text-indigo-600 dark:text-indigo-400", className)}
    >
      Terdaftar
    </Badge>
  ) : (
    <Badge variant="secondary" className={cn("border-0 bg-muted font-medium text-muted-foreground", className)}>
      Tamu
    </Badge>
  );
}
