"use client";
import { useEffect, useState } from "react";
import { ShoppingBag, Eye, Star, PackageMinus, UserPlus } from "lucide-react";
import type { Activity } from "@/lib/mock/store";
import { timeAgo } from "@/lib/format";

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

export function LiveActivity({ items, online }: { items: Activity[]; online: number }) {
  // client-only ticker so the "online" count feels realtime (starts from SSR value → no mismatch)
  const [count, setCount] = useState(online);
  useEffect(() => {
    const id = setInterval(() => {
      setCount((c) => Math.max(28, Math.min(72, c + Math.round((Math.random() - 0.5) * 6))));
    }, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-70" />
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
        </span>
        <span className="text-sm font-medium tabular-nums">{count} pengunjung online</span>
        <span className="ml-auto text-xs text-muted-foreground">realtime</span>
      </div>
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
                <p className="text-xs text-muted-foreground">{timeAgo(a.minutesAgo)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
