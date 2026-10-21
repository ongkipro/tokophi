import { notFound } from "next/navigation";
import { CRM_ENABLED } from "@/lib/nav";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  if (!CRM_ENABLED) notFound();
  return children;
}
