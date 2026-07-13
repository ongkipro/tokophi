"use client";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { PAGE_SIZE } from "./ledger-ui";
import { useSaldoUrl } from "./use-saldo-url";

/**
 * NUMBERED pages, not "muat lebih banyak".
 *
 * A wallet is reconciled, not browsed. The merchant arrives knowing what they are looking for ("the
 * payout in May", "the last page of March") and needs to reach it in one jump — with 640 movements
 * and growing, "load more" makes the oldest row 32 clicks deep and gives no sense of how much there
 * is. Numbered pages also make the total visible, which is the number a seller is really asking for
 * ("berapa banyak?"), and they survive a refresh: the page is in the URL, so an export or a shared
 * link lands on exactly the rows the merchant was looking at.
 */
export function SaldoPager({ page, pageCount, total, unit }: { page: number; pageCount: number; total: number; unit: string }) {
  const { goPage, pageHref } = useSaldoUrl();
  if (total === 0) return null;

  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1,
  );

  const jump = (e: React.MouseEvent, p: number) => {
    e.preventDefault();
    goPage(p);
  };

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row">
      <p className="text-sm text-muted-foreground">
        Menampilkan{" "}
        <span className="font-medium tabular-nums text-foreground">
          {start}–{end}
        </span>{" "}
        dari <span className="font-medium tabular-nums text-foreground">{total}</span> {unit}
      </p>
      {pageCount > 1 && (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                text="Sebelumnya"
                href={pageHref(Math.max(1, page - 1))}
                aria-disabled={page === 1}
                className={page === 1 ? "pointer-events-none opacity-50" : undefined}
                onClick={(e) => jump(e, Math.max(1, page - 1))}
              />
            </PaginationItem>
            {pages.map((p, i, arr) => (
              <PaginationItem key={p}>
                {i > 0 && arr[i - 1] !== p - 1 && <span className="px-1 text-muted-foreground">…</span>}
                <PaginationLink isActive={p === page} href={pageHref(p)} onClick={(e) => jump(e, p)}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                text="Berikutnya"
                href={pageHref(Math.min(pageCount, page + 1))}
                aria-disabled={page === pageCount}
                className={page === pageCount ? "pointer-events-none opacity-50" : undefined}
                onClick={(e) => jump(e, Math.min(pageCount, page + 1))}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
