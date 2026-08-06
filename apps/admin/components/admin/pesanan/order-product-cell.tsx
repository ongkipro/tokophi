import Link from "next/link";
import { ProductThumb } from "@/components/admin/product-thumb";
import type { OrderListLine } from "@/components/admin/pesanan/order-list-types";

// Shopee's row leads with the PRODUCT, not the invoice number: a seller packing parcels is looking
// for the thing on the shelf. Photo + name + `Variasi:` + qty, first two lines, then a count.
export function OrderProductCell({ lines, lineCount, href }: { lines: OrderListLine[]; lineCount: number; href?: string }) {
  if (lines.length === 0) {
    return <span className="text-sm text-muted-foreground">Tidak ada item</span>;
  }
  return (
    <div className="flex flex-col gap-2">
      {lines.map((l, i) => (
        <div key={`${l.title}-${l.variant ?? ""}-${i}`} className="flex items-start gap-2.5">
          <ProductThumb
            src={l.image ?? undefined}
            emoji={l.emoji ?? undefined}
            alt={l.title}
            className="size-11"
            emojiClassName="text-lg"
          />
          <div className="min-w-0 flex-1 leading-tight">
            {href ? (
              <Link href={href} className="line-clamp-2 whitespace-normal break-words text-sm font-medium hover:underline" title={l.title}>
                {l.title}
              </Link>
            ) : (
              <div className="line-clamp-2 whitespace-normal break-words text-sm font-medium" title={l.title}>{l.title}</div>
            )}
            {l.variant && (
              <div className="truncate text-xs text-muted-foreground">Variasi: {l.variant}</div>
            )}
            <div className="text-xs tabular-nums text-muted-foreground">x{l.qty}</div>
          </div>
        </div>
      ))}
      {lineCount > lines.length && (
        <p className="pl-[54px] text-xs text-muted-foreground">
          +{lineCount - lines.length} produk lainnya
        </p>
      )}
    </div>
  );
}
