import type { BannerPromoConfig } from "@tokophi/sections";

export function BannerPromo({ heading, subheading, imageUrl, href, badge }: BannerPromoConfig) {
  return (
    <a
      href={href || undefined}
      className="group relative flex min-h-[200px] items-center overflow-hidden rounded-2xl bg-gradient-to-br from-rose-200 to-rose-50 p-8"
    >
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-90 transition group-hover:scale-105"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/20 to-transparent" />
      <div className="relative space-y-2 text-white">
        {badge && (
          <span className="inline-block rounded-full bg-rose-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            {badge}
          </span>
        )}
        <h3 className="text-2xl font-semibold">{heading}</h3>
        <p className="max-w-sm text-white/85">{subheading}</p>
      </div>
    </a>
  );
}
