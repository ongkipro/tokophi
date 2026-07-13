"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * The Saldo page keeps tab / filter / page in the URL (see app/(admin)/saldo/page.tsx). This is the
 * one place that knows how to patch it, so a filter can never be applied in a way that forgets to
 * reset the page — landing on "halaman 12" of a 2-page result is the classic paging bug, and the
 * only fix that holds is to make it structurally impossible.
 */
export type UrlPatch = Record<string, string | undefined>;

export function useSaldoUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const href = (patch: UrlPatch): string => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return s ? `${pathname}?${s}` : pathname;
  };

  /** Change a filter → always back to page 1. */
  const filter = (patch: UrlPatch) => router.push(href({ ...patch, hal: undefined }), { scroll: false });
  /** Change the page → keep every filter. */
  const goPage = (page: number) => router.push(href({ hal: page === 1 ? undefined : String(page) }), { scroll: false });
  const pageHref = (page: number) => href({ hal: page === 1 ? undefined : String(page) });

  return { href, filter, goPage, pageHref };
}
