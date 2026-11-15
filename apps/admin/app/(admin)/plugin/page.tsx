import { PageHeader } from "@/components/admin/page-header";
import { PluginCard } from "@/components/admin/plugin/plugin-card";

// Toko Online → Plugin (ADR 0021 §5, PLUG-NAV). The list + switches moved here unchanged from
// Pengaturan; `plugins:manage` (owner-only) stays enforced in every action, the card only hides.
export default function PluginPage() {
  return (
    <div>
      <PageHeader title="Plugin" />
      <div className="max-w-3xl">
        <PluginCard />
      </div>
    </div>
  );
}
