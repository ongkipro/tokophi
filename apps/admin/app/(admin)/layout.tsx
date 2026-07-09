import { Sidebar } from "@/components/admin/sidebar";
import { Topbar } from "@/components/admin/topbar";
import { Toaster } from "sonner";
import { getSession } from "@/lib/auth";
import { getStoreName, getStoreSlug } from "@/lib/data/store";
import { getSearchIndex } from "@/lib/data/search";
import { PermissionsProvider } from "@/components/admin/permissions";
import { StoreProvider } from "@/components/admin/store-context";
import { getBilling } from "@/lib/data/billing";
import { IDR } from "@tokophi/lib/format";
import Link from "next/link";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const user = session ? { name: session.name, email: session.email, role: session.role } : undefined;
  const [storeName, storeSlug, searchIndex, bill] = session
    ? await Promise.all([getStoreName(session.storeId), getStoreSlug(session.storeId), getSearchIndex(), getBilling()])
    : [null, null, [], null];
  return (
    <PermissionsProvider role={session?.role}>
      <StoreProvider name={storeName ?? "Toko"} slug={storeSlug ?? ""}>
      <div className="flex min-h-screen w-full">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar user={user} storeName={storeName ?? undefined} searchIndex={searchIndex} />
          {bill && (bill.status === "past_due" || bill.status === "suspended") && (
            <Link
              href="/pengaturan/langganan"
              className={`block px-4 py-2 text-center text-sm font-medium ${bill.status === "suspended" ? "bg-destructive text-white" : "bg-orange-500 text-white"}`}
            >
              {bill.status === "suspended"
                ? `Langganan ditangguhkan — mode baca-saja. Bayar ${IDR(bill.nextAmount)} untuk mengaktifkan kembali →`
                : `Tagihan ${IDR(bill.nextAmount)} menunggu — bayar dalam ${bill.daysLeft} hari sebelum toko ditangguhkan →`}
            </Link>
          )}
          <main className="flex-1 bg-muted/30 p-4 sm:p-6">{children}</main>
        </div>
        <Toaster position="top-center" richColors closeButton />
      </div>
      </StoreProvider>
    </PermissionsProvider>
  );
}
