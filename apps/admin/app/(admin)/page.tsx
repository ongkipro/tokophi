import { getDailyStats, getChannelSalesDaily, getProductSalesDaily } from "@/lib/data/analytics";
import { getFunnelDaily } from "@/lib/data/funnel";
import { getProducts } from "@/lib/data/products";
import { getOrders } from "@/lib/data/orders";
import { getReviews } from "@/lib/data/reviews";
import { getMyTickets } from "@/lib/data/support";
import { getReturnsByCourier } from "@/lib/data/returns";
import { getStoreName } from "@/lib/data/store";
import { getActivityFeed } from "@/lib/data/activity";
import { getSession } from "@/lib/auth";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

// Every prop below is a row set from an existing RLS-scoped query — nothing on this page is
// synthesized. `products`/`orders`/`reviews`/`tickets` feed the action queue (counts) as well as
// their existing uses; `returns` feeds the retur rate (orders.status = 'retur', migration 0039).
export default async function DashboardPage() {
  const session = await getSession();
  const [days, products, orders, reviews, tickets, returns, storeName, activities, channels, productSales, funnel] =
    await Promise.all([
      getDailyStats(),
      getProducts(), // action queue (stok) + CSV export
      getOrders(),
      getReviews(), // action queue (ulasan menunggu moderasi)
      getMyTickets(), // action queue (tiket terbuka)
      getReturnsByCourier(),
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
      reviews={reviews}
      tickets={tickets}
      returns={returns}
      activities={activities}
      channels={channels}
      productSales={productSales}
      funnel={funnel}
      storeName={storeName ?? undefined}
      ownerName={session?.name}
    />
  );
}
