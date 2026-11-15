import type { BannerPromoConfig } from "@tokophi/sections";

export function BannerPromo({ heading, subheading, imageUrl, href, badge }: BannerPromoConfig) {
  return (
    <a
      href={href || undefined}
      className="group relative flex min-h-[200px] items-center overflow-hidden rounded-sm bg-gradient-to-br from-rose-200 to-rose-50 p-8"
    >
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-90 transition group-hover:scale-[1.03]"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/20 to-transparent" />
      <div className="relative space-y-2 text-white">
        {badge && (
          <span className="inline-block rounded-sm bg-ink px-2 py-0.5 text-xs font-semibold text-white">
            {badge}
          </span>
        )}
        <h3 className="font-display text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] sm:text-[1.75rem]">{heading}</h3>
        <p className="max-w-sm text-white/85">{subheading}</p>
      </div>
    </a>
  );
}
