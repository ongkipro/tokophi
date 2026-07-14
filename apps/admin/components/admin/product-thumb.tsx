import { cn } from "@tokophi/ui/lib/utils";

// Product image tile with emoji fallback. Size/rounding via className on the box.
export function ProductThumb({
  src,
  emoji,
  alt = "",
  className,
  emojiClassName = "text-xl",
}: {
  src?: string;
  emoji?: string;
  alt?: string;
  className?: string;
  emojiClassName?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" className="size-full object-cover" />
      ) : (
        <span className={emojiClassName}>{emoji}</span>
      )}
    </div>
  );
}
