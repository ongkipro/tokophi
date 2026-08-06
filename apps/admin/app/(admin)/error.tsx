"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";

import { EmptyState } from "@/components/admin/empty-state";

/**
 * THE THIRD EMPTY STATE. Every screen under `(admin)` reads through `lib/data/*`, and a read that
 * throws (the database unreachable, an RLS role that cannot be assumed, a malformed id reaching an
 * enum cast) had NO boundary here at all — the seller got Next's own error page, which in production
 * is the bare "Application error: a server-side exception has occurred" digest and nothing else.
 *
 * "Belum ada data" over a failed read is the same lie pointing the other way: the merchant concludes
 * their orders are gone. A failure says it failed, and offers the retry.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The server digest is the only handle support has on a production stack trace, so it is shown
  // when there is one — and never invented when there is not.
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      card
      kind="galat"
      title="Halaman ini gagal dimuat"
      desc={
        <>
          Datanya tidak berhasil diambil, jadi yang tampil di layar belum tentu lengkap. Coba muat
          ulang — kalau masih gagal, kirim kode di bawah lewat menu Bantuan.
          {error.digest ? (
            <>
              {" "}
              <span className="font-mono text-xs">{error.digest}</span>
            </>
          ) : null}
        </>
      }
      action={{ label: "Muat ulang", icon: RotateCcw, onClick: reset }}
      secondary={{ label: "Ke Dashboard", href: "/" }}
    />
  );
}
