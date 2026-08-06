import { cn } from "@tokophi/ui/lib/utils";
import { BrandWordmark } from "@tokophi/ui/brand-wordmark";

/**
 * Tanda merk sidebar Seller. Ubin indigo + ikon `Store` dari lucide DIBUANG — alasannya di
 * `packages/ui/src/components/ui/brand-wordmark.tsx`: ikon generik di sebelah wordmark yang sudah
 * memuat Φ membuat mata berhenti di kotak berwarna, bukan di nama produknya.
 */
export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("leading-tight", className)}>
      <BrandWordmark className="text-[15px]" />
      <div className="text-[11px] text-muted-foreground">Dashboard Seller</div>
    </div>
  );
}
