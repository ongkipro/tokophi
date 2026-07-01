import type { TopProduct } from "@/lib/data/dashboard";
import { ProductThumb } from "@/components/admin/product-thumb";
import { IDR, num } from "@/lib/format";

export function TopProducts({ items }: { items: TopProduct[] }) {
  const max = Math.max(...items.map((i) => i.revenue), 1);
  return (
    <ul className="space-y-4">
      {items.map((p, i) => (
        <li key={p.id} className="flex items-center gap-3">
          <ProductThumb src={p.image} emoji={p.emoji} alt={p.name} className="size-9" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium">{p.name}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{IDR(p.revenue, { compact: true })}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(p.revenue / max) * 100}%` }} />
              </div>
              <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{num(p.units)} terjual</span>
            </div>
          </div>
          <span className="w-5 text-right text-xs font-medium text-muted-foreground">#{i + 1}</span>
        </li>
      ))}
    </ul>
  );
}
