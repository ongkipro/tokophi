"use client"

import * as React from "react"
import {
  Bell,
  MapPin,
  Globe,
  Landmark,
  Receipt,
  Truck,
  Users,
  Store,
} from "lucide-react"

import { PageHeader } from "@/components/admin/page-header"
import { ToggleRow } from "@/components/admin/pengaturan/toggle-row"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@tokophi/ui/card"
import { useStoreName } from "@/components/admin/store-context"
import { initials } from "@/components/admin/initials"
import { Badge } from "@tokophi/ui/badge"
import { Separator } from "@tokophi/ui/separator"
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar"
import { SenderAddressCard } from "@/components/admin/pengaturan/sender-address-card"
import { JasaKirimCard } from "@/components/admin/pengaturan/jasa-kirim-card"
import { RekeningCard } from "@/components/admin/pengaturan/rekening-card"
import { StoreProfileCard } from "@/components/admin/pengaturan/store-profile-card"
import { DomainCard } from "@/components/admin/pengaturan/domain-card"
import { PenggunaCard } from "@/components/admin/pengaturan/pengguna-card"
import { PajakCard } from "@/components/admin/pengaturan/pajak-card"

// NOTE: there is no "pembayaran" section. Payment channels are a PLATFORM decision
// (super-admin → platform_payment_channels) and flow straight to the shopper's checkout.
// The merchant does not pick them — the old tab wrote store_settings.payment_channels /
// payment_fee_bearer, which NOTHING read: the storefront reads the platform table and the
// order API validates against AUTOLARIS_KNOWN_CHANNELS. It was an illusion of control.
type Section =
  | "profil"
  | "pengiriman"
  | "alamat"
  | "domain"
  | "rekening"
  | "pajak"
  | "pengguna"
  | "notifikasi"

const SECTIONS: {
  id: Section
  label: string
  desc: string
  icon: React.ReactNode
}[] = [
  { id: "profil", label: "Profil Toko", desc: "Nama, logo, kontak", icon: <Store /> },
  { id: "pengiriman", label: "Pengiriman", desc: "Jasa kirim & COD", icon: <Truck /> },
  { id: "alamat", label: "Alamat", desc: "Alamat pengambilan", icon: <MapPin /> },
  { id: "domain", label: "Domain", desc: "Domain kustom storefront", icon: <Globe /> },
  { id: "rekening", label: "Rekening", desc: "Tujuan penarikan saldo", icon: <Landmark /> },
  { id: "pajak", label: "Pajak", desc: "PPN & NPWP", icon: <Receipt /> },
  { id: "pengguna", label: "Pengguna", desc: "Anggota & peran", icon: <Users /> },
  {
    id: "notifikasi",
    label: "Notifikasi",
    desc: "Email & WhatsApp",
    icon: <Bell />,
  },
]



// Notifikasi is still a display-only preview: there is no notification system or column for those
// prefs, so its toggles persist nothing and it keeps this honest footnote rather than a no-op Save
// button. (Pajak used to be here too, but PPN is now real — tax settings persist to store_settings and
// the order API prices them; see PajakCard.) The wired sections use their own real save handlers.
function SaveFooter() {
  return (
    <CardFooter className="justify-end">
      <p className="text-xs text-muted-foreground">Segera hadir — perubahan pada bagian ini belum tersimpan.</p>
    </CardFooter>
  )
}

export default function Page() {
  // Navigasi
  const [section, setSection] = React.useState<Section>("profil")
  const storeName = useStoreName()


  // Notifikasi
  const [notif, setNotif] = React.useState({
    emailPesanan: true,
    waPesanan: true,
    emailStok: true,
    ringkasanHarian: false,
    emailPelanggan: false,
  })

  const setNotifKey = (k: keyof typeof notif) => (v: boolean) =>
    setNotif((s) => ({ ...s, [k]: v }))


  return (
    <div>
      <PageHeader
        title="Pengaturan"
        desc="Kelola profil toko, pembayaran, pengiriman, dan pengguna."
      />

      <div className="grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)]">
        {/* LEFT RAIL */}
        <div className="lg:sticky lg:top-6 h-fit space-y-4">
          <Card className="p-1.5">
            <nav className="flex flex-col gap-0.5">
              {SECTIONS.map((s) => {
                const active = section === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSection(s.id)}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-muted",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4",
                        active
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      ].join(" ")}
                    >
                      {s.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {s.label}
                      </span>
                      <span
                        className={[
                          "block truncate text-xs",
                          active ? "text-primary/70" : "text-muted-foreground",
                        ].join(" ")}
                      >
                        {s.desc}
                      </span>
                    </span>
                  </button>
                )
              })}
            </nav>
          </Card>

          {/* Ringkasan toko */}
          <Card>
            <CardContent className="grid gap-3 py-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-10">
                  <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                    {initials(storeName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {storeName}
                  </p>
                  <Badge variant="secondary" className="mt-1">
                    Paket TokoΦ
                  </Badge>
                </div>
              </div>

              <Separator />

              <ul className="grid gap-2 text-sm">
                {/* The active-service count now lives inside JasaKirimCard, which owns that state.
                    Re-deriving it here would mean a second source of truth that can disagree. */}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT CONTENT */}
        <div className="min-w-0 space-y-5">
          {/* PROFIL TOKO */}
          {section === "profil" && (
            <StoreProfileCard />
          )}

          {/* PENGIRIMAN — jasa kirim + COD. Grouped by KiriminAja's own speed classes.
              The old block let the merchant tick COURIERS ("JNE"), which cannot express "JNE
              Reguler yes, JNE YES no", and drew from a hand-written roster that had drifted from
              the API. It also carried two toggles — "Ambil di tempat" and "Gratis ongkir
              Rp250.000" — that were plain useState with NO column and NO action behind them: the
              merchant set them and nothing whatsoever happened. Removed rather than left lying. */}
          {section === "pengiriman" && (
            <div className="max-w-3xl">
              <JasaKirimCard />
            </div>
          )}

          {/* REKENING — where a payout is SENT. Same single writer as Saldo → Rekening
              (lib/actions/ledger saveBankAccount), so the two screens cannot drift apart about
              where a merchant's money goes. */}
          {section === "rekening" && (
            <div className="max-w-3xl">
              <RekeningCard />
            </div>
          )}

          {/* ALAMAT — the pickup origin. Its own section: it is an address, not a shipping
              preference, and every courier rate depends on it. */}
          {section === "alamat" && (
            <div className="max-w-3xl">
              <SenderAddressCard />
            </div>
          )}

          {/* DOMAIN */}
          {section === "domain" && (
            <div className="max-w-3xl">
              <DomainCard />
            </div>
          )}

          {/* PAJAK — real PPN settings, persisted to store_settings + priced by the order API */}
          {section === "pajak" && <PajakCard />}

          {/* PENGGUNA — real store_users list + invite/role/remove (lib/actions/users.ts) */}
          {section === "pengguna" && <PenggunaCard />}

          {/* NOTIFIKASI */}
          {section === "notifikasi" && (
            <Card className="max-w-3xl">
              <CardHeader>
                <CardTitle>Notifikasi</CardTitle>
                <CardDescription>
                  Pilih pemberitahuan yang ingin Anda terima lewat email & WhatsApp.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <ToggleRow
                  icon={<Bell />}
                  title="Email pesanan baru"
                  description="Kirim email setiap ada pesanan masuk."
                  checked={notif.emailPesanan}
                  onCheckedChange={setNotifKey("emailPesanan")}
                />
                <ToggleRow
                  icon={<Bell />}
                  title="WhatsApp pesanan baru"
                  description="Notifikasi WhatsApp untuk pesanan masuk."
                  checked={notif.waPesanan}
                  onCheckedChange={setNotifKey("waPesanan")}
                />
                <ToggleRow
                  icon={<Bell />}
                  title="Email stok menipis"
                  description="Peringatan saat stok produk hampir habis."
                  checked={notif.emailStok}
                  onCheckedChange={setNotifKey("emailStok")}
                />
                <ToggleRow
                  icon={<Bell />}
                  title="Ringkasan harian"
                  description="Rangkuman penjualan dikirim setiap pagi."
                  checked={notif.ringkasanHarian}
                  onCheckedChange={setNotifKey("ringkasanHarian")}
                />
                <ToggleRow
                  icon={<Bell />}
                  title="Email pelanggan baru"
                  description="Beri tahu saat pelanggan baru mendaftar."
                  checked={notif.emailPelanggan}
                  onCheckedChange={setNotifKey("emailPelanggan")}
                />
              </CardContent>
              <SaveFooter />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
