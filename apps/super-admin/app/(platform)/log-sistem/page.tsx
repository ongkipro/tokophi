import { ScrollText, Search } from "lucide-react";
import { platformRouteGate } from "@/lib/platform-auth";
import { RouteDenied } from "@/components/route-denied";
import { getActivityLog, getStoreOptions } from "@/lib/data";
import { ACTIVITY_KINDS, ACTIVITY_KIND_LABEL, LOG_PAGE_SIZE, logHref, logPages, parseLogQuery } from "@/lib/activity-log";
import { ActivityIcon } from "@/components/bits";
import { Card, CardContent } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Badge } from "@tokophi/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@tokophi/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@tokophi/ui/pagination";
import { dateTimeShort, num, timeAgo } from "@tokophi/lib/format";

export const dynamic = "force-dynamic";

/**
 * `/log-sistem` — the platform's audit log (`platform_activity`), whole, filtered and paged.
 *
 * Until this screen the log had two readers: the dashboard's 8-row "Aktivitas Platform" card and the
 * 20-row "Aktivitas & audit" card on one store's detail. Every `logStore`/`logPlatform` line written
 * by an operator action — a password reset, a suspension, a VIP grant, a courier or channel toggle —
 * scrolled off the dashboard within a day and was then unreadable from any screen. An audit log
 * nobody can page through is a write-only table.
 *
 * Server-rendered on purpose, with the filter as a GET form and the pager as plain links: the state
 * IS the URL, so an operator can paste "every action on this store" into a ticket, and there is no
 * client bundle to hydrate over a table of text. Native `<select>` — AGENTS.md rules out the shadcn
 * `Select` here, and a form control the browser already ships needs no replacement.
 *
 * `select` styling mirrors `Input` (same tokens) so the row reads as one control group.
 */
const SELECT =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export default async function LogSistemPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // SEC-9: the rank floor for this route group, BEFORE a single privileged read.
  // `platformGate(min)` inside each action stays the mutation boundary; this is additive.
  const gate = await platformRouteGate("/log-sistem");
  if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;

  const query = parseLogQuery(await searchParams);
  const [{ rows, total, page }, stores] = await Promise.all([getActivityLog(query), getStoreOptions()]);
  // `page` is the one the database actually served (clamped inside `getActivityLog`), not the URL's.
  const pager = logPages(total, page, LOG_PAGE_SIZE);
  const from = total === 0 ? 0 : (pager.page - 1) * LOG_PAGE_SIZE + 1;
  const to = total === 0 ? 0 : from + rows.length - 1;
  const filtered = Boolean(query.kind || query.storeId || query.q);

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ScrollText className="size-6 text-muted-foreground" aria-hidden /> Log Sistem
          </h1>
          <p className="text-sm text-muted-foreground">
            Jejak audit platform: setiap tindakan operator dan peristiwa sistem, terbaru di atas. Tindakan pada satu toko juga tampil di halaman toko tersebut.
          </p>
        </div>
        <Badge variant="outline" className="w-fit tabular-nums">{num(total)} catatan{filtered ? " (tersaring)" : ""}</Badge>
      </div>

      {/* Filter — a GET form; the URL is the state. `page` is deliberately NOT carried: a new filter starts at page 1. */}
      <form method="get" action="/log-sistem" className="flex flex-wrap items-end gap-2" role="search" aria-label="Saring log">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Jenis
          <select name="kind" defaultValue={query.kind ?? ""} className={SELECT}>
            <option value="">Semua jenis</option>
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>{ACTIVITY_KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Toko
          <select name="toko" defaultValue={query.storeId ?? ""} className={SELECT + " max-w-60"}>
            <option value="">Semua toko &amp; platform</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          Cari teks
          <Input name="q" defaultValue={query.q} placeholder="mis. password, ditangguhkan, kurir…" maxLength={120} />
        </label>
        <Button type="submit" variant="outline"><Search data-icon="inline-start" /> Saring</Button>
        {filtered ? <Button nativeButton={false} variant="ghost" render={<a href="/log-sistem">Hapus filter</a>} /> : null}
      </form>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {filtered ? "Tidak ada catatan yang cocok dengan filter ini." : "Belum ada aktivitas tercatat."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><span className="sr-only">Jenis</span></TableHead>
                    <TableHead>Catatan</TableHead>
                    <TableHead className="w-44">Toko</TableHead>
                    <TableHead className="w-44">Waktu (WIB)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell><ActivityIcon kind={r.kind} /></TableCell>
                      <TableCell className="whitespace-normal">
                        <p className="text-sm leading-snug">{r.text}</p>
                        <p className="text-xs text-muted-foreground">{ACTIVITY_KIND_LABEL[r.kind]}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.storeId ? (
                          <a href={`/toko/${r.storeId}`} className="hover:underline">{r.storeName ?? "Toko terhapus"}</a>
                        ) : (
                          <span className="text-muted-foreground">Platform</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        <time dateTime={new Date(r.ts).toISOString()}>{dateTimeShort(r.ts)}</time>
                        <p className="text-xs text-muted-foreground">{timeAgo(r.minutesAgo)}</p>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {pager.pageCount > 1 ? (
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <p className="text-xs text-muted-foreground tabular-nums">
            Menampilkan {num(from)}–{num(to)} dari {num(total)} · halaman {num(pager.page)} dari {num(pager.pageCount)}
          </p>
          {/* Real links: filters travel in the href, and the browser's own history handles back/forward. */}
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious text="Sebelumnya" aria-disabled={pager.page === 1} href={pager.page === 1 ? undefined : logHref(query, pager.page - 1)} className={pager.page === 1 ? "pointer-events-none opacity-50" : undefined} />
              </PaginationItem>
              {pager.numbers.map((n, i) => (
                <PaginationItem key={n}>
                  {i > 0 && pager.numbers[i - 1] !== n - 1 ? <PaginationEllipsis /> : null}
                  <PaginationLink href={logHref(query, n)} isActive={n === pager.page}>{n}</PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext text="Berikutnya" aria-disabled={pager.page === pager.pageCount} href={pager.page === pager.pageCount ? undefined : logHref(query, pager.page + 1)} className={pager.page === pager.pageCount ? "pointer-events-none opacity-50" : undefined} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      ) : null}
    </div>
  );
}
