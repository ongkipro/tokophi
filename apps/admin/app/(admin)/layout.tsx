import { Sidebar } from "@/components/admin/sidebar";
import { Topbar } from "@/components/admin/topbar";
import { AdminChrome } from "@/components/admin/admin-chrome";
import { getSession } from "@/lib/auth";
import { getStoreName, getStoreSlug } from "@/lib/data/store";
import { getSearchIndex } from "@/lib/data/search";
import { PermissionsProvider } from "@/components/admin/permissions";
import { StoreProvider } from "@/components/admin/store-context";
import { getBilling } from "@/lib/data/billing";
import { getTopbarData } from "@/lib/data/topbar";
import { getPerluDikirimCount } from "@/lib/data/orders";
import { IDR } from "@tokophi/lib/format";
import Link from "next/link";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const user = session ? { name: session.name, email: session.email, role: session.role } : undefined;
  // Fetched ONCE here and handed to both chrome surfaces — the sidebar and the mobile drawer
  // render the same nav, and two copies of this query would be two chances to disagree.
  const [storeName, storeSlug, searchIndex, bill, topbar, perluDikirim] = session
    ? await Promise.all([
        getStoreName(session.storeId),
        getStoreSlug(session.storeId),
        getSearchIndex(),
        getBilling(),
        getTopbarData(),
        getPerluDikirimCount(),
      ])
    : [null, null, [], null, null, 0];
  const navCounts = { perluDikirim: perluDikirim ?? 0 };
  const billingBanner = bill && (bill.status === "past_due" || bill.status === "suspended") && (
    <Link
      href="/akun/langganan"
      className={`block px-4 py-2 text-center text-sm font-medium ${bill.status === "suspended" ? "bg-destructive text-white" : "bg-orange-500 text-white"}`}
    >
      {bill.status === "suspended"
        ? `Langganan ditangguhkan — mode baca-saja. Bayar ${IDR(bill.nextAmount)} untuk mengaktifkan kembali →`
        : `Tagihan ${IDR(bill.nextAmount)} menunggu — bayar dalam ${bill.daysLeft} hari sebelum toko ditangguhkan →`}
    </Link>
  );
  return (
    <PermissionsProvider role={session?.role}>
      <StoreProvider name={storeName ?? "Toko"} slug={storeSlug ?? ""}>
        <AdminChrome
          sidebar={<Sidebar navCounts={navCounts} />}
          topbar={
            <Topbar
              user={user}
              storeName={storeName ?? undefined}
              searchIndex={searchIndex}
              balance={topbar?.balance}
              notifs={topbar?.notifs}
              navCounts={navCounts}
            />
          }
          billingBanner={billingBanner}
        >
          {children}
        </AdminChrome>
      </StoreProvider>
    </PermissionsProvider>
  );
}
