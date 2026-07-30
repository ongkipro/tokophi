import { Truck, ShieldCheck, RotateCcw, Headphones, CreditCard, Package, MessageCircle } from "lucide-react";
import type { MulticolumnConfig } from "@tokophi/sections";

// Editor preview — the React half of the icon allow-list (the Astro half lives in
// sections/Multicolumn.astro). Same keys, same fallback: an unknown key renders a neutral dot on
// both sides, so the builder can never show an icon the storefront will not.
const ICONS = {
  truck: Truck,
  shield: ShieldCheck,
  returns: RotateCcw,
  support: Headphones,
  payment: CreditCard,
  package: Package,
  chat: MessageCircle,
} as const;

const COLS = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" } as const;

export function Multicolumn({ heading, eyebrow, columns, items }: MulticolumnConfig) {
  const rows = (items ?? []).filter((i) => i.title?.trim());

  return (
    <section className="p-6">
      {heading && (
        <div className="mb-6 text-center">
          {eyebrow && <p className="text-xs font-medium tracking-wide text-brand-600 uppercase">{eyebrow}</p>}
          <h2 className="mt-1 text-xl font-semibold text-ink">{heading}</h2>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-ink/15 p-6 text-center text-sm text-ink/50">
          Belum ada kolom. Tambahkan minimal satu — section ini tidak tampil di storefront selama masih kosong.
        </p>
      ) : (
        <ul className={`grid gap-8 ${COLS[columns] ?? COLS[3]}`}>
          {rows.map((row, i) => {
            const Icon = ICONS[row.icon as keyof typeof ICONS];
            return (
              <li key={i} className="flex flex-col items-center text-center">
                <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  {Icon ? (
                    <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <span className="size-2 rounded-full bg-current" aria-hidden="true" />
                  )}
                </span>
                <h3 className="font-medium text-ink">{row.title}</h3>
                {row.text?.trim() && <p className="mt-1 text-sm text-ink/60">{row.text}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
