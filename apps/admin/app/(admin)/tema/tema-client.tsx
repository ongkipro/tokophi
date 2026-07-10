"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Puck, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import "@/lib/theme/puck-theme.css";
import { toast } from "sonner";
import { puckConfig } from "@/lib/theme/puck-config";
import { puckFieldOverrides } from "@/lib/theme/puck-field-overrides";
import { saveHomepage } from "@/lib/actions/theme";
import { useCan } from "@/components/admin/permissions";
import { Button } from "@/components/ui/button";
import { BrandColorDialog } from "@/components/theme/brand-color-dialog";

export function TemaClient({ initialData, initialBrandColor }: { initialData: Data; initialBrandColor: string }) {
  const canWrite = useCan("theme:write");
  const [, startTransition] = React.useTransition();

  const handlePublish = (data: Data) => {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah tema toko");
      return;
    }
    startTransition(async () => {
      try {
        await saveHomepage(data);
        toast.success("Beranda tersimpan");
      } catch {
        toast.error("Gagal menyimpan beranda");
      }
    });
  };

  return (
    <div className="h-screen w-full">
      <Puck
        config={puckConfig}
        data={initialData}
        onPublish={handlePublish}
        headerTitle="Tema Toko — Beranda"
        overrides={{
          headerActions: ({ children }) => (
            <>
              <Button nativeButton={false} variant="ghost" size="sm" render={<Link href="/" />}>
                <ArrowLeft data-icon="inline-start" />
                Kembali ke Admin
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
