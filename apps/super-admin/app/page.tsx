import { Button } from "@indostore/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@indostore/ui/card";
import { IDR } from "@indostore/lib/format";

export default function Home() {
  return (
    <main className="mx-auto max-w-lg p-10">
      <Card>
        <CardHeader>
          <CardTitle>Indostore — Super Admin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Wiring check: shared UI (@indostore/ui) + shared lib (@indostore/lib) → {IDR(1250000)}.
          </p>
          <Button>Tombol dari packages/ui</Button>
        </CardContent>
      </Card>
    </main>
  );
}
