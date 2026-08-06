import { Sidebar } from "@/components/admin/sidebar";
import { Topbar } from "@/components/admin/topbar";
import { AdminChrome } from "@/components/admin/admin-chrome";
import { getSession } from "@/lib/auth";
import { getStoreName, getStoreSlug } from "@/lib/data/store";
import { systemDomainFor } from "@/lib/data/domain";
import { getSearchIndex } from "@/lib/data/search";
import { PermissionsProvider } from "@/components/admin/permissions";
import { StoreProvider } from "@/components/admin/store-context";
import { getBilling } from "@/lib/data/billing";
import { getTopbarData } from "@/lib/data/topbar";
import { getPerluDikirimCount } from "@/lib/data/orders";
import { IDR } from "@tokophi/lib/format";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  // ⚠️ NO SESSION HERE MEANS THE MEMBERSHIP IS GONE, not that the cookie is missing — `middleware.ts`
  // already turned away anyone without a valid JWT, and it runs on the edge where it cannot ask the
  // database. `getSession` re-checks `store_users` on every request, so a user removed from the store
  // still holds a perfectly valid token and lands HERE. Without this redirect they got the full admin
  // chrome wrapped around an empty dashboard: every read silently scoped to the NO_STORE sentinel,
  // nothing leaked, and nothing explained why their shop had vanished. Send them to the login screen.
  // …to the sign-out route, NOT straight to /login: middleware sees the still-valid JWT and would
  // bounce /login back to /, and the two would ping-pong (ERR_TOO_MANY_REDIRECTS — measured). The
  // cookie has to actually go, and only a route handler can delete one.
  if (!session) redirect("/api/auth/signout");
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
  // The store's public storefront origin for "Kunjungi storefront" (same helper as the Domain card).
  const storefrontHost = storeSlug ? systemDomainFor(storeSlug) : "";
  // ⚠️ AN OPERATOR SUSPENSION IS NOT A BILL, AND MUST NOT BE DRESSED AS ONE. Telling a merchant we
  // locked for abuse to "bayar Rp305.250 untuk mengaktifkan kembali" sends them to pay money that
  // will not unlock anything — the payment lands, `currentPeriodEnd` moves, and the panel stays
  // read-only, correctly. They get the reason and a route to support instead.
  const operatorSuspended = !!bill?.operatorSuspended;
  // ⚠️ AND A STORE NOBODY HAS REVIEWED YET IS NOT A STORE WE PUNISHED (0090). Self-serve signup
  // creates the shop locked, so this banner is the FIRST thing a new merchant reads — and with one
  // set of words for both cases it read "Toko ditangguhkan oleh TokoΦ" to someone who had just
  // handed us their details thirty seconds earlier. Amber, not red; an apology with a timeframe,
  // not an accusation; and no "hubungi kami", because there is nothing for them to do yet.
  const pendingApproval = !!bill?.pendingApproval;
  const billingBanner = bill && (operatorSuspended || bill.status === "past_due" || bill.status === "suspended") && (
    <Link
      href={operatorSuspended ? "/bantuan" : "/akun/langganan"}
      // tabular-nums: this banner is the widest-travelling figure in the panel and it crosses the
      // FULL viewport on every route. Measured 1440px, all-1 vs all-8 on
      // "Tagihan Rp 275.000 menunggu — bayar dalam 1 hari …": 24,67px of ink. It is `text-center`, so
      // the whole sentence slides both ways around the amount as the countdown ticks down through 10
      // → 9 and as the invoice total changes.
      className={`block px-4 py-2 text-center text-sm font-medium tabular-nums ${
        pendingApproval ? "bg-amber-500 text-white" : bill.status === "suspended" ? "bg-destructive text-white" : "bg-orange-500 text-white"
      }`}
    >
      {pendingApproval
        ? // The reason string already carries the wait and the timeframe, so the banner adds only what it
          // does NOT say: what still works. Repeating both read as two apologies stacked (measured on
          // screen), which is how a 30-second-old shop ends up with a two-line orange wall.
          `${bill.suspendedReason ?? "Toko sedang ditinjau."} Kamu bisa melihat-lihat dulu — penyimpanan aktif setelah disetujui.`
        : operatorSuspended
        ? `Toko ditangguhkan oleh TokoΦ — mode baca-saja.${bill.suspendedReason ? ` Alasan: ${bill.suspendedReason}.` : ""} Hubungi kami untuk menindaklanjuti →`
        : bill.status === "suspended"
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
              storefrontHost={storefrontHost}
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
