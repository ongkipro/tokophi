import { getDailyStats } from "@/lib/data/analytics";
import { getProducts } from "@/lib/data/products";
import { AnalitikClient } from "./analitik-client";

export const dynamic = "force-dynamic";

export default async function AnalitikPage() {
  const [days, products] = await Promise.all([getDailyStats(), getProducts()]);
  return <AnalitikClient days={days} products={products} />;
}
