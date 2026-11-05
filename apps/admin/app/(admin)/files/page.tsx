import { getMediaPage } from "@/lib/actions/media";
import { clampMediaPage, MEDIA_PAGE_SIZE } from "@/lib/media-page";
import { PageHeader } from "@/components/admin/page-header";
import { FilesClient } from "./files-client";

export const dynamic = "force-dynamic";

// One bounded page per request, resolved here from `?page=` — a store with hundreds of uploads never
// ships every thumbnail to the browser. The count comes from the first read, so a page that no longer
// exists (the last file of the last page was just deleted) is re-read as the last page that does.
export default async function FilesPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const wanted = clampMediaPage(raw, Number.MAX_SAFE_INTEGER);
  let { items, total } = await getMediaPage({ offset: (wanted - 1) * MEDIA_PAGE_SIZE, limit: MEDIA_PAGE_SIZE });
  const page = clampMediaPage(raw, total);
  if (page !== wanted) ({ items, total } = await getMediaPage({ offset: (page - 1) * MEDIA_PAGE_SIZE, limit: MEDIA_PAGE_SIZE }));
  return (
    <div className="space-y-6">
      <PageHeader title="Files" desc="Pustaka media toko — semua gambar diunggah di sini, otomatis dikonversi ke WebP." />
      <FilesClient media={items} total={total} page={page} pageSize={MEDIA_PAGE_SIZE} />
    </div>
  );
}
