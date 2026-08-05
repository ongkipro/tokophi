"use client";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@tokophi/ui/pagination";
import { num } from "@tokophi/lib/format";

export const ADMIN_LIST_PAGE_SIZE = 10;

export function ListPagination({ page, total, unit, onPageChange }: {
  page: number;
  total: number;
  unit: string;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_LIST_PAGE_SIZE));
  const start = total === 0 ? 0 : (page - 1) * ADMIN_LIST_PAGE_SIZE + 1;
  const end = Math.min(page * ADMIN_LIST_PAGE_SIZE, total);
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (item) => item === 1 || item === pageCount || Math.abs(item - page) <= 1,
  );

  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Menampilkan <span className="font-medium tabular-nums text-foreground">{num(start)}–{num(end)}</span> dari{" "}
        <span className="font-medium tabular-nums text-foreground">{num(total)}</span> {unit}
      </p>
      {pageCount > 1 && (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                text="Sebelumnya"
                href={page > 1 ? "#" : undefined}
                aria-disabled={page === 1}
                className={page === 1 ? "pointer-events-none opacity-50" : undefined}
                onClick={page > 1 ? (event) => { event.preventDefault(); onPageChange(page - 1); } : undefined}
              />
            </PaginationItem>
            {pages.map((item, index) => (
              <PaginationItem key={item}>
                {index > 0 && pages[index - 1] !== item - 1 && <span className="px-1 text-muted-foreground">…</span>}
                <PaginationLink href="#" isActive={item === page} onClick={(event) => { event.preventDefault(); onPageChange(item); }}>{item}</PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                text="Berikutnya"
                href={page < pageCount ? "#" : undefined}
                aria-disabled={page === pageCount}
                className={page === pageCount ? "pointer-events-none opacity-50" : undefined}
                onClick={page < pageCount ? (event) => { event.preventDefault(); onPageChange(page + 1); } : undefined}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
