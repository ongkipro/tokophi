import type { CategoryNavConfig } from "@tokophi/sections";

export function CategoryNav({ items }: CategoryNavConfig) {
  return (
    <section className="flex flex-wrap justify-center gap-6 p-6">
      {items.map((item, i) => (
        <div key={i} className="flex flex-col items-center gap-2">
          <div className="h-20 w-20 overflow-hidden rounded-full bg-gradient-to-br from-stone-300 to-stone-100">
            {item.imageUrl && <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />}
          </div>
          <span className="text-sm font-medium text-stone-700">{item.label}</span>
        </div>
      ))}
    </section>
  );
}
