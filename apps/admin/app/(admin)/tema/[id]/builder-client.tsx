"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Puck, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import "@/lib/theme/puck-theme.css";
import { toast } from "sonner";
import { puckFieldOverrides } from "@/lib/theme/puck-field-overrides";
import { builderConfig } from "./hero-carousel";
import { saveTemplate } from "@/lib/actions/theme";
import { useCan } from "@/components/admin/permissions";
import { Button } from "@/components/ui/button";
import { BrandColorDialog } from "@/components/theme/brand-color-dialog";

export function BuilderClient({
  templateId,
  title,
  initialData,
  initialBrandColor,
}: {
  templateId: string;
  title: string;
  initialData: Data;
  initialBrandColor: string;
}) {
  const canWrite = useCan("theme:write");
  const [, startTransition] = React.useTransition();

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
        config={builderConfig}
        data={initialData}
        onPublish={handlePublish}
        headerTitle={`Tema Toko — ${title}`}
        overrides={{
          headerActions: ({ children }) => (
            <>
              <Button nativeButton={false} variant="ghost" size="sm" render={<Link href="/tema" />}>
                <ArrowLeft data-icon="inline-start" />
                Kembali ke Daftar Template
              </Button>
              <BrandColorDialog initialColor={initialBrandColor} />
              {children}
            </>
          ),
          fieldTypes: puckFieldOverrides,
        }}
      />
    </div>
  );
}
