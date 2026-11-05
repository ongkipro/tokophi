import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getStoreSlug } from "@/lib/data/store";
import { crmEnabled } from "@/lib/nav";

// CRM is hidden from every store except the demo one until it runs on WhatsApp Business (WABA) —
// owner ruling 2026-11-03, rule in `lib/nav.ts` `crmEnabled`. Hiding the menu is not enough: a
// bookmarked or typed /crm URL must not open it either, so every route under /crm answers 404 here.
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !crmEnabled(await getStoreSlug(session.storeId))) notFound();
  return children;
}
