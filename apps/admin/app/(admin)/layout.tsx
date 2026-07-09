import { Sidebar } from "@/components/admin/sidebar";
import { Topbar } from "@/components/admin/topbar";
import { Toaster } from "sonner";
import { getSession } from "@/lib/auth";
import { getStoreName, getStoreSlug } from "@/lib/data/store";
import { getSearchIndex } from "@/lib/data/search";
import { PermissionsProvider } from "@/components/admin/permissions";
import { StoreProvider } from "@/components/admin/store-context";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const user = session ? { name: session.name, email: session.email, role: session.role } : undefined;
  const [storeName, storeSlug, searchIndex] = session
    ? await Promise.all([getStoreName(session.storeId), getStoreSlug(session.storeId), getSearchIndex()])
    : [null, null, []];
  return (
    <PermissionsProvider role={session?.role}>
      <StoreProvider name={storeName ?? "Toko"} slug={storeSlug ?? ""}>
      <div className="flex min-h-screen w-full">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar user={user} storeName={storeName ?? undefined} searchIndex={searchIndex} />
          <main className="flex-1 bg-muted/30 p-4 sm:p-6">{children}</main>
        </div>
        <Toaster position="top-center" richColors closeButton />
      </div>
      </StoreProvider>
    </PermissionsProvider>
  );
}
