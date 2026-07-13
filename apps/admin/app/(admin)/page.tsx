import { getDailyStats, getChannelSalesDaily, getProductSalesDaily } from "@/lib/data/analytics";
import { getFunnelDaily } from "@/lib/data/funnel";
import { getProducts } from "@/lib/data/products";
import { getOrders } from "@/lib/data/orders";
import { getStoreName } from "@/lib/data/store";
import { getActivityFeed } from "@/lib/data/activity";
import { getSession } from "@/lib/auth";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  const [days, products, orders, storeName, activities, channels, productSales, funnel] = await Promise.all([
    getDailyStats(),
    getProducts(), // CSV export only
    getOrders(),
    session ? getStoreName(session.storeId) : Promise.resolve(null),
    getActivityFeed(),
    getChannelSalesDaily(),
    getProductSalesDaily(),
    getFunnelDaily(),
  ]);
  // No "pengunjung online" ticker: nothing tracks concurrent sessions. Pengunjung/Konversi are
  // COUNTED from analytics_events (funnel rows) and fall back to "—" for a store with no events.
  return (
    <DashboardClient
      days={days}
      products={products}
      orders={orders}
      activities={activities}
      channels={channels}
      productSales={productSales}
      funnel={funnel}
      storeName={storeName ?? undefined}
      ownerName={session?.name}
    />
  );
}
