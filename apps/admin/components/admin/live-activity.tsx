import { ShoppingBag, Eye, Star, PackageMinus, UserPlus } from "lucide-react";
import type { Activity } from "@/lib/mock/store";
import { timeAgo } from "@tokophi/lib/format";

const ICON: Record<Activity["kind"], typeof Eye> = {
  order: ShoppingBag, visitor: Eye, review: Star, stock: PackageMinus, signup: UserPlus,
};
const TONE: Record<Activity["kind"], string> = {
  order: "text-emerald-600 bg-emerald-500/12",
  visitor: "text-blue-600 bg-blue-500/12",
  review: "text-amber-600 bg-amber-500/15",
  stock: "text-red-600 bg-red-500/12",
  signup: "text-violet-600 bg-violet-500/12",
};

// No "pengunjung online" counter here: the storefront has no session tracking
// (`analytics_events` exists in the schema but is empty and has no writer), so any
// number shown would be invented. The items below are real store events.
export function LiveActivity({ items }: { items: Activity[] }) {
  // With no events this rendered an EMPTY `<ul>` — a card with a title and literally nothing under
  // it, indistinguishable from a broken query. Same one-line form as the dashboard's other empty
  // cards.
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Belum ada aktivitas. Pesanan, ulasan, dan perubahan stok akan tercatat di sini.
      </p>
    );
  }
  return (
    <div>
      <ul className="space-y-3.5">
        {items.map((a) => {
          const Icon = ICON[a.kind];
          return (
            <li key={a.id} className="flex gap-3">
              <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${TONE[a.kind]}`}>
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{a.text}</p>
                {/* `timeAgo()` is the one string on this card that changes without anybody acting:
                    "17 hari lalu" → "18 hari lalu" on the next render. Measured 5,77px of ink per
                    row at 1440px, and the rows re-render together, so the whole column jittered. */}
                <p className="text-xs text-muted-foreground tabular-nums">{timeAgo(a.minutesAgo)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
