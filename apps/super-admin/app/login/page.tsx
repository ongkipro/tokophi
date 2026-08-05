"use client";
import { useActionState } from "react";
import { signIn } from "@/lib/actions/auth";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@tokophi/ui/card";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {/* `level={1}` — the third and last screen of this shape. `CardTitle` defaults to `h2`
              because a card normally sits under a page `PageHeader`; the two login screens and
              `/daftar` are the only places where the card IS the page. Every other super-admin route
              draws its own `<h1>` (9 routes checked, 8 of them do), so those keep the default.
              Missing this one would have left the CONTROL PLANE's front door with no `h1` at all. */}
          <CardTitle level={1} className="text-2xl tracking-tight">TokoΦ</CardTitle>
          <CardDescription>Masuk ke panel Super Admin (platform)</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              {/* ⚠️ NO `defaultValue`, and this is the CONTROL PLANE. It pre-filled the seeded
                  operator's address — an account the seed genuinely creates on deploy — so the page
                  that reaches every store on the platform named the one account worth attacking.
                  That matters more here than on the Seller panel: the login limiter is keyed on IP,
                  not on account (AGENTS.md), so nothing anywhere records that one specific operator
                  is being tried. The `placeholder` shows the shape without naming anyone. */}
              <Input id="email" name="email" type="email" placeholder="nama@tokophi.id" required autoComplete="email" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Kata sandi</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </div>
            {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
            <Button type="submit" disabled={pending}>{pending ? "Masuk…" : "Masuk"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
