import { getMedia } from "@/lib/actions/media";
import { PageHeader } from "@/components/admin/page-header";
import { FilesClient } from "./files-client";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const media = await getMedia();
  return (
    <div className="space-y-6">
      <PageHeader title="Files" desc="Pustaka media toko — semua gambar diunggah di sini, otomatis dikonversi ke WebP." />
      <FilesClient media={media} />
    </div>
  );
}
