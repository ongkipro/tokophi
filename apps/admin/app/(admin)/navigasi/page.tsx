import { getMenus } from "@/lib/data/menus";
import { NavigasiClient } from "./navigasi-client";

export const dynamic = "force-dynamic";

export default async function NavigasiPage() {
  const menus = await getMenus();
  return <NavigasiClient menus={menus} />;
}
