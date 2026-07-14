import {
  getOrderList,
  type OrderSearchField,
  type OrderTab,
  ORDER_TABS,
  ORDER_SEARCH_FIELDS,
} from "@/lib/data/orders";
import { getReturnsByCourier } from "@/lib/data/returns";
import { PesananClient } from "./pesanan-client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

// Filter/search/pagination state lives in the URL and is resolved HERE, on the server. 685 orders
// never cross the wire; each view is one bounded query. It also means a filtered list is a link a
// merchant can bookmark or send to a staffer (and the sidebar's Pesanan submenu is exactly that).
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PesananPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;

  const tabParam = one(sp.tab) as OrderTab;
  const tab: OrderTab = ORDER_TABS.some((t) => t.value === tabParam) ? tabParam : "semua";

  const fieldParam = one(sp.field) as OrderSearchField;
  const field: OrderSearchField = ORDER_SEARCH_FIELDS.some((f) => f.value === fieldParam) ? fieldParam : "no";

  const q = one(sp.q);
  const courier = one(sp.kurir);
  const method = one(sp.bayar);
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const [list, returns] = await Promise.all([
    getOrderList({ tab, field, q, courier, method, page, pageSize: PAGE_SIZE }),
    getReturnsByCourier(),
  ]);

  return (
    <PesananClient
      list={list}
      tab={tab}
      filters={{ field, q, courier, method }}
      returns={returns}
    />
  );
}
