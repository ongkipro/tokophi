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
          <CardTitle className="text-2xl tracking-tight">TokoΦ</CardTitle>
          <CardDescription>Masuk ke panel Super Admin (platform)</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="nama@tokophi.id" required autoComplete="email" defaultValue="admin@tokophi.id" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Kata sandi</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </div>
            {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
            <Button type="submit" disabled={pending}>{pending ? "Masuk…" : "Masuk"}</Button>
            <p className="text-center text-xs text-muted-foreground">Dev: admin@tokophi.id / tokophi123</p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
