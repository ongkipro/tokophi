import { getDailyStats } from "@/lib/data/analytics";
import { getProducts } from "@/lib/data/products";
import { getOrders } from "@/lib/data/orders";
import { getStoreName } from "@/lib/data/store";
import { getActivityFeed } from "@/lib/data/activity";
import { getSession } from "@/lib/auth";
import { ONLINE_NOW } from "@/lib/mock/store";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  const [days, products, orders, storeName, activities] = await Promise.all([
    getDailyStats(),
    getProducts(),
    getOrders(),
    session ? getStoreName(session.storeId) : Promise.resolve(null),
    getActivityFeed(),
  ]);
  // ONLINE_NOW is the decorative realtime visitor ticker; the activity feed is now real (per store).
  return (
    <DashboardClient
      days={days}
      products={products}
      orders={orders}
      activities={activities}
      onlineNow={ONLINE_NOW}
      storeName={storeName ?? undefined}
      ownerName={session?.name}
    />
  );
}
