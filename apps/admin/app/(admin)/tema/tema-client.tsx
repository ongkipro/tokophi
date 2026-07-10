"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Puck, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import "@/lib/theme/puck-theme.css";
import { toast } from "sonner";
import type { ColorPalette } from "@tokophi/sections";
import { buildPuckConfig } from "@/lib/theme/puck-config";
import { puckFieldOverrides } from "@/lib/theme/puck-field-overrides";
import { saveHomepage } from "@/lib/actions/theme";
import { useCan } from "@/components/admin/permissions";
import { Button } from "@/components/ui/button";
import { BrandColorDialog } from "@/components/theme/brand-color-dialog";
import { PaletteManagerDialog } from "@/components/theme/palette-manager-dialog";

export function TemaClient({
  initialData,
  initialBrandColor,
  initialPalettes,
}: {
  initialData: Data;
  initialBrandColor: string;
  initialPalettes: ColorPalette[];
}) {
  const canWrite = useCan("theme:write");
  const [, startTransition] = React.useTransition();
  const config = React.useMemo(() => buildPuckConfig(initialPalettes), [initialPalettes]);

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
        config={config}
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
              <PaletteManagerDialog palettes={initialPalettes} />
              {children}
            </>
          ),
          fieldTypes: puckFieldOverrides,
        }}
      />
    </div>
  );
}
