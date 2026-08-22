// The screen an under-privileged operator gets INSTEAD of a protected page (Task 5.17 / SEC-9).
//
// It is rendered in place of the page's own output, and — this is the whole point — the page
// returns it BEFORE it reads anything: no payout queue, no bank accounts, no invoices are fetched,
// so nothing privileged reaches the response even as data the markup did not happen to print.
//
// It says the rank required, the rank held, and WHY the floor is where it is. A refusal nobody can
// act on becomes a support ticket; "Tidak diizinkan" alone does not tell an operator whether to ask
// for a promotion or to stop asking. Server-safe (no state, no handlers) so it can be returned
// directly from a Server Component.
import Link from "next/link";
import { ShieldAlert, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@tokophi/ui/card";
import { Badge } from "@tokophi/ui/badge";

export function RouteDenied({
  need,
  role,
  reason,
  landing,
}: {
  need: string;
  role: string;
  reason: string;
  landing: string;
}) {
  return (
    <div className="mx-auto flex max-w-2xl items-center justify-center py-16">
      <Card className="w-full">
        <CardContent className="space-y-4 py-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/12">
            <ShieldAlert className="size-6 text-destructive" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Halaman ini di luar peran Anda</h1>
            {/* The same sentence the action gate speaks, from the same function. */}
            <p className="text-sm text-muted-foreground">
              Tidak diizinkan — perlu peran{" "}
              <Badge variant="secondary" className="border-transparent align-middle">
                {need}
              </Badge>{" "}
              , akun ini{" "}
              <Badge variant="secondary" className="border-transparent align-middle">
                {role || "tanpa peran"}
              </Badge>
              .
            </p>
          </div>
          <p className="text-sm text-muted-foreground">{reason}</p>
          <p className="text-xs text-muted-foreground">
            Minta operator ber-peran <strong>{need}</strong> untuk menaikkan peran akun Anda di Pengaturan → Tim Platform.
          </p>
          <Link
            href={landing}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Kembali ke halaman yang bisa Anda buka <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
