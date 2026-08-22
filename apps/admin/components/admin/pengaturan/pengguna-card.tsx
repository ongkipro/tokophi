"use client";
import * as React from "react";
import { toast } from "sonner";
import { UserPlus, MoreHorizontal, Copy, Check } from "lucide-react";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Badge } from "@tokophi/ui/badge";
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@tokophi/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";
import { useCan } from "@/components/admin/permissions";
import {
  getStoreUsers, inviteStoreUser, setStoreUserRole, removeStoreUser,
  type StoreUserRow, type ManageableRole, type InviteResult,
} from "@/lib/actions/users";

const ROLE_LABEL: Record<string, string> = { owner: "Pemilik", admin: "Admin", staff: "Staf", gudang: "Staf Gudang" };
const ROLE_BADGE: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default", admin: "secondary", staff: "outline", gudang: "outline",
};
const fmtTanggal = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
const MANAGEABLE: { role: ManageableRole; label: string }[] = [
  { role: "admin", label: "Admin" },
  { role: "staff", label: "Staf" },
  { role: "gudang", label: "Staf Gudang" },
];

export function PenggunaCard() {
  const canManage = useCan("settings:write");
  const [rows, setRows] = React.useState<StoreUserRow[] | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [pending, start] = React.useTransition();

  const load = React.useCallback(() => {
    getStoreUsers().then(setRows).catch(() => setRows([]));
  }, []);
  React.useEffect(load, [load]);

  const changeRole = (userId: string, role: ManageableRole) =>
    start(async () => {
      const r = await setStoreUserRole(userId, role);
      if (r.ok) { toast.success("Peran diperbarui."); load(); }
      else toast.error(r.error ?? "Gagal memperbarui peran.");
    });
  const remove = (userId: string) =>
    start(async () => {
      const r = await removeStoreUser(userId);
      if (r.ok) { toast.success("Anggota dikeluarkan."); load(); }
      else toast.error(r.error ?? "Gagal mengeluarkan anggota.");
    });

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Pengguna &amp; Peran</CardTitle>
        <CardDescription>Kelola anggota tim yang memiliki akses ke dasbor toko.</CardDescription>
        {canManage && (
          <CardAction>
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus /> Undang pengguna
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-2">
        {rows === null ? (
          <p className="py-4 text-sm text-muted-foreground">Memuat anggota…</p>
        ) : (
          rows.map((m) => (
            <div key={m.userId} className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
              <Avatar>
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {(m.name || m.email).slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.name || "—"}
                  {m.isSelf && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(Anda)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
              </div>
              {/* Only the NULL case is rendered. A stamp proves they signed in; its absence proves
                  they never have — but rows written before Task 5.3 carry the invite's own timestamp,
                  so "sudah masuk" is not a claim this data can support. */}
              {m.acceptedAt === null && <Badge variant="outline">Belum pernah masuk</Badge>}
              <Badge variant={ROLE_BADGE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
              {canManage && m.role !== "owner" && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Aksi anggota" disabled={pending} />}>
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Ubah peran</DropdownMenuLabel>
                    {MANAGEABLE.filter((r) => r.role !== m.role).map((r) => (
                      <DropdownMenuItem key={r.role} onClick={() => changeRole(m.userId, r.role)}>{r.label}</DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => remove(m.userId)}>Keluarkan</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))
        )}

        {/* Role reference */}
        <div className="mt-1 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="mb-1.5 font-medium text-foreground">Peran</p>
          <ul className="grid gap-1">
            <li><span className="font-medium text-foreground">Owner</span> — akses penuh termasuk penagihan &amp; hapus toko.</li>
            <li><span className="font-medium text-foreground">Admin</span> — kelola produk, pesanan, dan pengaturan.</li>
            <li><span className="font-medium text-foreground">Staf</span> — akses terbatas untuk operasional harian.</li>
          </ul>
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <p className="mr-auto text-xs text-muted-foreground">
          <span className="tabular-nums">{rows?.length ?? 0}</span> anggota tim
        </p>
      </CardFooter>

      {inviteOpen && <InviteDialog onOpenChange={setInviteOpen} onDone={load} />}
    </Card>
  );
}

function InviteDialog({ onOpenChange, onDone }: { onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<ManageableRole>("staff");
  const [pending, start] = React.useTransition();
  // Set ONLY on `outcome: "created"` — the branch where the action wrote the row carrying this
  // string's hash. Locks the form into a "done" state; the password is shown once and never re-read.
  const [created, setCreated] = React.useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  // 🔴 EVERY BRANCH IS KEYED ON `outcome`, NEVER ON THE PRESENCE OF A PASSWORD. This used to read
  // `if (r.tempPassword) … else "ia masuk dengan kata sandinya yang sudah ada"` — so the cheerful
  // "they already have a password" line was what the seller saw for *any* path that did not hand one
  // back, including one that had minted a credential and then failed to store it. AGENTS.md: "no
  // password" and "no password was NEEDED" read identically, and only one of them is good news.
  // A reload is issued only where a row was actually written.
  const submit = () =>
    start(async () => {
      const r: InviteResult = await inviteStoreUser({ name, email, role });
      switch (r.outcome) {
        case "created":
          onDone();
          setCreated({ email: r.email, password: r.password });
          return;
        case "linked":
          onDone();
          toast.success(`${r.email} ditambahkan ke tim. Akunnya sudah ada, jadi kata sandinya TIDAK berubah.`);
          onOpenChange(false);
          return;
        case "already_invited":
          toast.info(
            `${r.email} sudah diundang${r.invitedAt ? ` pada ${fmtTanggal(r.invitedAt)}` : ""} sebagai ` +
              `${ROLE_LABEL[r.role] ?? r.role} dan belum pernah masuk. Kata sandinya tidak diubah.`,
          );
          return;
        case "already_accepted":
          toast.info(`${r.email} sudah menjadi ${ROLE_LABEL[r.role] ?? r.role} di toko ini. Tidak ada yang diubah.`);
          return;
        case "failed":
          toast.error(r.error);
          return;
      }
    });

  const copy = () => {
    if (created?.password) {
      navigator.clipboard?.writeText(created.password);
      setCopied(true);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Undang pengguna</DialogTitle>
          <DialogDescription>
            {created
              ? "Akun dibuat. Bagikan kata sandi sementara ini — hanya ditampilkan sekali."
              : "Beri anggota tim akses ke dasbor. Tanpa email — bagikan kata sandi sementara lewat WhatsApp."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="grid gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="text-sm font-medium">{created.email}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Kata sandi sementara</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-sm">{created.password}</code>
                <Button variant="outline" size="icon" onClick={copy} aria-label="Salin kata sandi">
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">Minta anggota menggantinya di Akun → Keamanan setelah masuk.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="inv-nama">Nama</Label>
              <Input id="inv-nama" placeholder="mis. Sari Dewi" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="inv-email">Email</Label>
              <Input id="inv-email" type="email" placeholder="mis. sari@toko.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Peran</Label>
              <div className="flex flex-wrap gap-1.5">
                {MANAGEABLE.map((r) => (
                  <Button key={r.role} type="button" size="sm" variant={r.role === role ? "secondary" : "outline"} onClick={() => setRole(r.role)}>
                    {r.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {created ? (
            <DialogClose render={<Button>Selesai</Button>} />
          ) : (
            <>
              <DialogClose render={<Button variant="outline">Tutup</Button>} />
              <Button disabled={pending || !name.trim() || !email.trim()} onClick={submit}>
                {pending ? "Mengundang…" : "Undang"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
