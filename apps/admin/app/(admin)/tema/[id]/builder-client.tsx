"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Puck, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import "@/lib/theme/puck-theme.css";
import { toast } from "sonner";
import { puckFieldOverrides } from "@/lib/theme/puck-field-overrides";
import { PuckA11yLabels } from "@/lib/theme/puck-a11y";
import { puckConfigFor, type TemplateType } from "@/lib/theme/puck-config";
import { saveTemplate } from "@/lib/actions/theme";
import { useCan } from "@/components/admin/permissions";
import { Button } from "@tokophi/ui/button";
import { BrandColorDialog } from "@/components/theme/brand-color-dialog";
import { generateBrandShades } from "@tokophi/lib/colors";

/** `{50: hex}` → `{"--color-brand-50": hex}` — the names `globals.css` and the storefront both use. */
function brandVars(hex: string): React.CSSProperties {
  return Object.fromEntries(
    Object.entries(generateBrandShades(hex)).map(([shade, value]) => [`--color-brand-${shade}`, value]),
  ) as React.CSSProperties;
}

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
  // Publish is the ONLY save — there is no draft column and no autosave — and for a default homepage
  // template it is live to shoppers within the storefront's 15s cache TTL. So the one thing that must
  // not happen quietly is losing the work: "Kembali ke Daftar Template" is a plain link sitting in the
  // same row as Publish, and a tab close is a tab close. A dirty flag + `beforeunload` is not the
  // draft/publish boundary this needs (that is a column), but it is the part that stops the loss.
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
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
        if (res.ok) { setDirty(false); toast.success("Template tersimpan"); }
        else toast.error(res.error);
      } catch {
        toast.error("Gagal menyimpan template");
      }
    });
  };

  return (
    // The canvas inherits `globals.css`'s PLATFORM rose, so the builder previewed a brand colour the
    // shop does not use — with the colour picker two pixels away in the same header.
    //
    // ⚠️ `generateBrandShades` returns `{50: "#…", 100: "#…"}` — NUMERIC keys, not CSS custom property
    // names. Handing that straight to `style` produces `{50: "#…"}`, which React silently drops: the
    // first version of this fix changed nothing at all, and a browser check (`--color-brand-600` on
    // the wrapper → `null`) is the only reason that was caught. Map to the same
    // `--color-brand-<shade>` names `globals.css` declares and the storefront's Layout emits.
    <div className="h-screen w-full" style={brandVars(initialBrandColor)}>
      {/* ⚠️ THIS ROUTE HAD NO `<h1>` AT ALL — measured in a browser, not inferred. It is FULL-BLEED
          (`admin-chrome.tsx` `FULL_BLEED`), so the sidebar and topbar are gone too, and everything
          Puck renders starts at `<h2>` (its `headerTitle`, "Components", "Outline", "Page"). A
          screen-reader user landing here had no top-level heading to orient on, on the one screen
          where the whole page is a canvas.
          `sr-only` rather than a visible heading for the same reason `index.astro` uses one on the
          storefront: the visible title already exists in Puck's own chrome, which we cannot re-tag,
          so a second visible one would be duplicate furniture. Same floor, same convention. */}
      <h1 className="sr-only">Tema Toko — {title}</h1>
      {/* Names Puck's own zoom select and array "add item" button — the two controls on this screen
          it renders without an accessible name, and the only two left after the field overrides.
          Renders nothing; see lib/theme/puck-a11y.tsx for why it is a DOM patch. */}
      <PuckA11yLabels />
      <Puck
        config={config}
        data={initialData}
        onChange={() => setDirty(true)}
        onPublish={handlePublish}
        headerTitle={`Tema Toko — ${title}`}
        // A role without `theme:write` could drag, edit and rearrange the whole page and only find
        // out at Publish, via a toast, with the work already done. Refuse the interaction instead.
        permissions={{ edit: canWrite, delete: canWrite, drag: canWrite, insert: canWrite }}
        overrides={{
          headerActions: ({ children }) => (
            <>
              <Button
                nativeButton={false}
                variant="ghost"
                size="sm"
                render={
                  <Link
                    href="/tema"
                    onClick={(e) => {
                      // The back link sits beside Publish. Without this, one mis-click discards every
                      // unsaved edit with no confirmation and nothing to recover from.
                      if (dirty && !window.confirm("Ada perubahan yang belum diterbitkan. Tinggalkan halaman ini?")) {
                        e.preventDefault();
                      }
                    }}
                  />
                }
              >
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
