import { getDailyStats } from "@/lib/data/analytics";
import { getProducts } from "@/lib/data/products";
import { getOrders } from "@/lib/data/orders";
import { ACTIVITIES, ONLINE_NOW } from "@/lib/mock/store";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [days, products, orders] = await Promise.all([getDailyStats(), getProducts(), getOrders()]);
  // ACTIVITIES + ONLINE_NOW are the realtime "live" widgets — kept from mock (decorative).
  return <DashboardClient days={days} products={products} orders={orders} activities={ACTIVITIES} onlineNow={ONLINE_NOW} />;
}
