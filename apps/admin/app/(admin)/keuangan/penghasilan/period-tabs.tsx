"use client";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@tokophi/ui/button";
import { TabStrip } from "@/components/admin/tab-strip";

// The period switcher. In the URL, not in state: a seller who bookmarks or shares "penghasilan 90
// hari" must get 90 days back, and the server re-queries rather than the browser re-filtering — the
// same rule the Pesanan list follows.
const PERIODS = [
  { days: 7, label: "7 hari" },
  { days: 30, label: "30 hari" },
  { days: 90, label: "90 hari" },
];

export function PeriodTabs({ days }: { days: number }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <TabStrip>
      <div className="flex w-max gap-1.5">
        {PERIODS.map((p) => (
          <Button
            key={p.days}
            size="sm"
            variant={days === p.days ? "secondary" : "ghost"}
            onClick={() => router.push(`${pathname}?hari=${p.days}`, { scroll: false })}
          >
            {p.label}
          </Button>
        ))}
      </div>
    </TabStrip>
  );
}
