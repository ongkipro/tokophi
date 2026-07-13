import {
  getDailyStats, getRegionSales, getCustomerMix, getCategorySales,
  getChannelSalesDaily, getProductSalesDaily, getOrderStats,
} from "@/lib/data/analytics";
import { getFunnelDaily, getDeviceDaily, FUNNEL_STEPS } from "@/lib/data/funnel";
import { getProducts } from "@/lib/data/products";
import { AnalitikClient } from "./analitik-client";

export const dynamic = "force-dynamic";

export default async function AnalitikPage() {
  const [days, products, regions, mix, categories, channels, productSales, stats, funnel, devices] = await Promise.all([
    getDailyStats(),
    getProducts(), // CSV export only
    getRegionSales(),
    getCustomerMix(),
    getCategorySales(),
    getChannelSalesDaily(),
    getProductSalesDaily(),
    getOrderStats(),
    getFunnelDaily(),
    getDeviceDaily(),
  ]);
  return (
    <AnalitikClient
      days={days}
      products={products}
      regions={regions}
      mix={mix}
      categories={categories}
      channels={channels}
      productSales={productSales}
      stats={stats}
      funnel={funnel}
      funnelSteps={[...FUNNEL_STEPS]}
      devices={devices}
    />
  );
}
