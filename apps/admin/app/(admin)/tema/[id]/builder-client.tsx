"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Puck, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import "@/lib/theme/puck-theme.css";
import { toast } from "sonner";
import { puckFieldOverrides } from "@/lib/theme/puck-field-overrides";
import { puckConfigFor, type TemplateType } from "@/lib/theme/puck-config";
import { saveTemplate } from "@/lib/actions/theme";
import { useCan } from "@/components/admin/permissions";
import { Button } from "@tokophi/ui/button";
import { BrandColorDialog } from "@/components/theme/brand-color-dialog";

export function BuilderClient({
  templateId,
  templateType,
  title,
  initialData,
  initialBrandColor,
}: {
  templateId: string;
  templateType: TemplateType;
  title: string;
  initialData: Data;
  initialBrandColor: string;
}) {
  const canWrite = useCan("theme:write");
  const [isPending, startTransition] = React.useTransition();
  // Only the sections that belong on THIS page type. Memoised because Puck re-mounts on a new config
  // object, which would drop the merchant's in-progress edits on every render.
  const config = React.useMemo(() => puckConfigFor(templateType), [templateType]);

  const handlePublish = (data: Data) => {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah tema toko");
      return;
    }
    startTransition(async () => {
      try {
        const res = await saveTemplate(templateId, data);
        if (res.ok) toast.success("Template tersimpan");
        else toast.error(res.error);
      } catch {
        toast.error("Gagal menyimpan template");
      }
    });
  };

  return (
    <div className="h-screen w-full">
      <Puck
        config={config}
        data={initialData}
        onPublish={handlePublish}
        headerTitle={`Tema Toko — ${title}`}
        // A role without `theme:write` could drag, edit and rearrange the whole page and only find
        // out at Publish, via a toast, with the work already done. Refuse the interaction instead.
        permissions={{ edit: canWrite, delete: canWrite, drag: canWrite, insert: canWrite }}
        overrides={{
          headerActions: ({ children }) => (
            <>
              <Button nativeButton={false} variant="ghost" size="sm" render={<Link href="/tema" />}>
                <ArrowLeft data-icon="inline-start" />
                Kembali ke Daftar Template
              </Button>
              <BrandColorDialog initialColor={initialBrandColor} />
              {/* Puck's own Publish button never changes during the round-trip, so two clicks wrote
                  twice. Swallow it while saving and say so — every sibling dialog in this app
                  ("Menyimpan…") already does. */}
              {isPending ? (
                <Button size="sm" disabled>
                  Menyimpan…
                </Button>
              ) : (
                children
              )}
            </>
          ),
          fieldTypes: puckFieldOverrides,
        }}
      />
    </div>
  );
}
