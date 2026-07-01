import { Card } from "@/components/ui/card";
import { Construction } from "lucide-react";

export function Placeholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mx-auto max-w-[1400px]">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      <Card className="mt-6 flex flex-col items-center justify-center gap-3 border-dashed p-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Construction className="size-6" />
        </div>
        <div className="text-base font-medium">Layar {title} — segera dibangun</div>
        <p className="max-w-md text-sm text-muted-foreground">
          UI/UX untuk modul ini akan menyusul setelah Dashboard. Data masih mock; backend disambung belakangan.
        </p>
      </Card>
    </div>
  );
}
