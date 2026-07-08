"use client"

import * as React from "react"
import {
  Banknote,
  Bell,
  CreditCard,
  Landmark,
  QrCode,
  Receipt,
  Truck,
  Users,
  Wallet,
  HandCoins,
  Store,
  Info,
  UserPlus,
  Save,
  Check,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/admin/page-header"
import { ToggleRow } from "@/components/admin/pengaturan/toggle-row"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useCan } from "@/components/admin/permissions"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

type Section =
  | "profil"
  | "pembayaran"
  | "pengiriman"
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
  {
    id: "pembayaran",
    label: "Pembayaran",
    desc: "Metode pembayaran",
    icon: <CreditCard />,
  },
  { id: "pengiriman", label: "Pengiriman", desc: "Kurir & ongkir", icon: <Truck /> },
  { id: "pajak", label: "Pajak", desc: "PPN & NPWP", icon: <Receipt /> },
  { id: "pengguna", label: "Pengguna", desc: "Anggota & peran", icon: <Users /> },
  {
    id: "notifikasi",
    label: "Notifikasi",
    desc: "Email & WhatsApp",
    icon: <Bell />,
  },
]

const COURIERS = [
  { key: "jne", name: "JNE", services: [{ key: "reg", name: "Reguler" }, { key: "yes", name: "YES" }, { key: "oke", name: "OKE" }] },
  { key: "jnt", name: "J&T Express", services: [{ key: "ez", name: "EZ" }, { key: "eco", name: "Ekonomi" }] },
  { key: "sicepat", name: "SiCepat", services: [{ key: "reg", name: "REG" }, { key: "best", name: "BEST" }, { key: "gokil", name: "GOKIL" }] },
  { key: "anteraja", name: "AnterAja", services: [{ key: "reg", name: "Reguler" }, { key: "sameday", name: "Same Day" }] },
  { key: "pos", name: "Pos Indonesia", services: [{ key: "kilat", name: "Kilat Khusus" }, { key: "reg", name: "Reguler" }] },
  { key: "gosend", name: "GoSend", services: [{ key: "instant", name: "Instant" }, { key: "sameday", name: "Same Day" }] },
  { key: "grab", name: "GrabExpress", services: [{ key: "instant", name: "Instant" }, { key: "sameday", name: "Same Day" }] },
] as const

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SaveFooter() {
  const canSave = useCan("settings:write")
  if (!canSave)
    return (
      <CardFooter className="justify-end">
        <p className="text-xs text-muted-foreground">Hanya Pemilik yang dapat mengubah pengaturan toko.</p>
      </CardFooter>
    )
  return (
    <CardFooter className="justify-end gap-2">
      <Button variant="ghost">Batal</Button>
      <Button>
        <Save />
        Simpan Perubahan
      </Button>
    </CardFooter>
  )
}

export default function Page() {
  // Navigasi
  const [section, setSection] = React.useState<Section>("profil")
  const canSettings = useCan("settings:write")

  // Pembayaran
  const [pay, setPay] = React.useState({
    transfer: true,
    qris: true,
    ewallet: true,
    kartu: false,
    cod: true,
    va: false,
  })

  // Pengiriman
  const [courierOn, setCourierOn] = React.useState<Record<string, boolean>>({
    jne: true,
    jnt: true,
    sicepat: true,
    anteraja: false,
    pos: false,
    gosend: true,
    grab: false,
  })
  const [serviceOn, setServiceOn] = React.useState<Record<string, boolean>>(
    () => {
      const s: Record<string, boolean> = {}
      COURIERS.forEach((c) =>
        c.services.forEach((sv) => {
          s[c.key + "." + sv.key] = true
        }),
      )
      return s
    },
  )
  const [gratisOngkir, setGratisOngkir] = React.useState(true)
  const [pickup, setPickup] = React.useState(false)

  // Pajak
  const [ppnAktif, setPpnAktif] = React.useState(true)
  const [ppnInclusive, setPpnInclusive] = React.useState(false)

  // Notifikasi
  const [notif, setNotif] = React.useState({
    emailPesanan: true,
    waPesanan: true,
    emailStok: true,
    ringkasanHarian: false,
    emailPelanggan: false,
  })

  const setPayKey = (k: keyof typeof pay) => (v: boolean) =>
    setPay((s) => ({ ...s, [k]: v }))
  const setNotifKey = (k: keyof typeof notif) => (v: boolean) =>
    setNotif((s) => ({ ...s, [k]: v }))

  const payTotal = Object.keys(pay).length
  const payActive = Object.values(pay).filter(Boolean).length
  const kurirActive = Object.values(courierOn).filter(Boolean).length

  const team = [
    {
      name: "Ongki",
      email: "ongki@batiknusantara.id",
      role: "Pemilik",
      variant: "default" as const,
    },
    {
      name: "Sari",
      email: "sari@batiknusantara.id",
      role: "Admin",
      variant: "secondary" as const,
    },
    {
      name: "Budi",
      email: "budi@batiknusantara.id",
      role: "Staf Gudang",
      variant: "outline" as const,
    },
  ]

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
                    BN
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    Batik Nusantara
                  </p>
                  <Badge variant="secondary" className="mt-1">
                    Paket Bisnis
                  </Badge>
                </div>
              </div>

              <Separator />

              <ul className="grid gap-2 text-sm">
                <li className="flex items-center gap-2 text-muted-foreground">
                  <CreditCard className="size-4 shrink-0" />
                  <span>
                    <span className="font-medium tabular-nums text-foreground">
                      {payActive}
                    </span>{" "}
                    metode bayar
                  </span>
                </li>
                <li className="flex items-center gap-2 text-muted-foreground">
                  <Truck className="size-4 shrink-0" />
                  <span>
                    <span className="font-medium tabular-nums text-foreground">
                      {kurirActive}
                    </span>{" "}
                    kurir aktif
                  </span>
                </li>
                <li className="flex items-center gap-2 text-muted-foreground">
                  <Receipt className="size-4 shrink-0" />
                  <span>
                    PPN{" "}
                    <span className="font-medium text-foreground">
                      {ppnAktif ? "11%" : "nonaktif"}
                    </span>
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT CONTENT */}
        <div className="min-w-0 space-y-5">
          {/* PROFIL TOKO */}
          {section === "profil" && (
            <Card className="max-w-3xl">
              <CardHeader>
                <CardTitle>Profil Toko</CardTitle>
                <CardDescription>
                  Informasi ini tampil di toko dan struk pesanan pelanggan.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <div className="flex items-center gap-4">
                  <Avatar size="lg" className="size-16">
                    <AvatarFallback className="bg-primary/10 text-base font-semibold text-primary">
                      BN
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid gap-1">
                    <p className="text-sm font-medium">Logo toko</p>
                    <p className="text-xs text-muted-foreground">
                      Format PNG atau JPG, maksimal 2 MB.
                    </p>
                    <div className="mt-1">
                      <Button variant="outline" size="sm">
                        <Store />
                        Ubah logo
                      </Button>
                    </div>
                  </div>
                </div>

                <Separator />

                <Field label="Nama toko" htmlFor="nama-toko">
                  <Input id="nama-toko" defaultValue="Batik Nusantara" />
                </Field>

                <Field
                  label="Deskripsi"
                  htmlFor="deskripsi"
                  hint="Ceritakan singkat tentang toko Anda."
                >
                  <Textarea
                    id="deskripsi"
                    rows={3}
                    defaultValue="Menyediakan batik tulis dan cap asli Nusantara dengan kualitas premium langsung dari pengrajin lokal."
                  />
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Email" htmlFor="email">
                    <Input
                      id="email"
                      type="email"
                      defaultValue="halo@batiknusantara.id"
                    />
                  </Field>
                  <Field label="No. WhatsApp" htmlFor="wa">
                    <Input id="wa" defaultValue="+62 812 3456 7890" />
                  </Field>
                </div>

                <Field label="Alamat" htmlFor="alamat">
                  <Textarea
                    id="alamat"
                    rows={2}
                    defaultValue="Jl. Malioboro No. 12, Yogyakarta, DI Yogyakarta 55213"
                  />
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label="Zona waktu"
                    htmlFor="zona-waktu"
                    hint="Digunakan untuk jadwal & laporan."
                  >
                    <Input
                      id="zona-waktu"
                      value="Asia/Jakarta (WIB)"
                      readOnly
                      disabled
                    />
                  </Field>
                  <Field
                    label="Bahasa"
                    htmlFor="bahasa"
                    hint="Bahasa antarmuka dasbor."
                  >
                    <Input
                      id="bahasa"
                      value="Bahasa Indonesia"
                      readOnly
                      disabled
                    />
                  </Field>
                </div>

                <Field
                  label="Mata uang"
                  htmlFor="mata-uang"
                  hint="Mata uang toko tidak dapat diubah."
                >
                  <Input id="mata-uang" value="Rupiah (IDR)" readOnly disabled />
                </Field>
              </CardContent>
              <SaveFooter />
            </Card>
          )}

          {/* PEMBAYARAN */}
          {section === "pembayaran" && (
            <Card className="max-w-3xl">
              <CardHeader>
                <CardTitle>Metode Pembayaran</CardTitle>
                <CardDescription>
                  Aktifkan metode pembayaran yang tersedia untuk pelanggan Anda.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>
                    Gateway pembayaran &amp; COD disediakan dan dikelola oleh{" "}
                    <span className="font-medium text-foreground">TokoΦ</span>. Anda cukup mengaktifkan metode yang ingin diterima — tanpa daftar akun atau isi API sendiri.
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium tabular-nums text-foreground">
                    {payActive}
                  </span>{" "}
                  dari{" "}
                  <span className="tabular-nums">{payTotal}</span> metode aktif
                </p>
                <ToggleRow
                  icon={<Landmark />}
                  title="Transfer Bank"
                  description="BCA, Mandiri, BRI"
                  checked={pay.transfer}
                  onCheckedChange={setPayKey("transfer")}
                />
                <ToggleRow
                  icon={<QrCode />}
                  title="QRIS"
                  description="Pembayaran instan lewat semua aplikasi QRIS"
                  checked={pay.qris}
                  onCheckedChange={setPayKey("qris")}
                />
                <ToggleRow
                  icon={<Wallet />}
                  title="E-wallet"
                  description="OVO, GoPay, DANA, ShopeePay"
                  checked={pay.ewallet}
                  onCheckedChange={setPayKey("ewallet")}
                />
                <ToggleRow
                  icon={<CreditCard />}
                  title="Kartu Kredit/Debit"
                  description="Visa, Mastercard, JCB"
                  checked={pay.kartu}
                  onCheckedChange={setPayKey("kartu")}
                />
                <ToggleRow
                  icon={<HandCoins />}
                  title="COD (Bayar di Tempat)"
                  description="Pembayaran tunai saat pesanan tiba"
                  checked={pay.cod}
                  onCheckedChange={setPayKey("cod")}
                />
                <ToggleRow
                  icon={<Banknote />}
                  title="Virtual Account"
                  description="Nomor VA otomatis per bank"
                  checked={pay.va}
                  onCheckedChange={setPayKey("va")}
                />
              </CardContent>
              <SaveFooter />
            </Card>
          )}

          {/* PENGIRIMAN */}
          {section === "pengiriman" && (
            <Card className="max-w-3xl">
              <CardHeader>
                <CardTitle>Kurir Pengiriman</CardTitle>
                <CardDescription>
                  Pilih kurir dan layanan (ekspedisi) yang ingin ditawarkan ke
                  pelanggan. Integrasi &amp; tarif dikelola TokoΦ.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>
                    Integrasi kurir &amp; tarif ongkir dikelola oleh{" "}
                    <span className="font-medium text-foreground">TokoΦ</span>. Anda cukup memilih kurir yang ingin ditawarkan — resi &amp; tarif otomatis.
                  </span>
                </div>
                {COURIERS.map((c) => {
                  const on = courierOn[c.key]
                  const activeServices = c.services.filter(
                    (sv) => serviceOn[c.key + "." + sv.key],
                  ).length
                  return (
                    <div
                      key={c.key}
                      className={cn(
                        "rounded-lg border p-3 transition-opacity",
                        !on && "opacity-60",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
                          <Truck />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{c.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {on
                              ? `${activeServices} layanan aktif`
                              : "Nonaktif"}
                          </p>
                        </div>
                        <Switch
                          checked={on}
                          onCheckedChange={(v) =>
                            setCourierOn((s) => ({ ...s, [c.key]: v }))
                          }
                        />
                      </div>

                      {on && (
                        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                          {c.services.map((sv) => {
                            const id = c.key + "." + sv.key
                            const svOn = serviceOn[id]
                            return (
                              <button
                                key={sv.key}
                                type="button"
                                onClick={() =>
                                  setServiceOn((s) => ({ ...s, [id]: !s[id] }))
                                }
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors",
                                  svOn
                                    ? "border-primary bg-primary/10 text-primary font-medium"
                                    : "border-border text-muted-foreground hover:bg-muted",
                                )}
                              >
                                {svOn && <Check className="size-3" />}
                                {sv.name}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}

                <Separator className="my-1" />

                <ToggleRow
                  icon={<Store />}
                  title="Ambil di toko (pickup)"
                  description="Pelanggan dapat mengambil pesanan langsung di toko."
                  checked={pickup}
                  onCheckedChange={setPickup}
                />
                <p className="text-xs text-muted-foreground">
                  Aktifkan bila toko fisik Anda melayani pengambilan mandiri.
                </p>

                <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/40 p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Gratis ongkir</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Berikan gratis ongkir bila belanja melewati nilai minimum.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                        Rp
                      </span>
                      <Input
                        className="w-40 pl-8 tabular-nums"
                        inputMode="numeric"
                        defaultValue="250.000"
                        disabled={!gratisOngkir}
                      />
                    </div>
                    <Switch
                      checked={gratisOngkir}
                      onCheckedChange={setGratisOngkir}
                    />
                  </div>
                </div>
              </CardContent>
              <SaveFooter />
            </Card>
          )}

          {/* PAJAK */}
          {section === "pajak" && (
            <Card className="max-w-3xl">
              <CardHeader>
                <CardTitle>Pajak</CardTitle>
                <CardDescription>
                  Atur penerapan Pajak Pertambahan Nilai (PPN) pada pesanan.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Aktifkan PPN</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Tambahkan PPN pada setiap transaksi pelanggan.
                    </p>
                  </div>
                  <Switch checked={ppnAktif} onCheckedChange={setPpnAktif} />
                </div>

                <Field
                  label="Tarif PPN (%)"
                  htmlFor="tarif-ppn"
                  hint="Tarif PPN umum di Indonesia saat ini 11%."
                >
                  <Input
                    id="tarif-ppn"
                    className="max-w-40 tabular-nums"
                    inputMode="numeric"
                    defaultValue="11"
                    disabled={!ppnAktif}
                  />
                </Field>

                <Field
                  label="NPWP"
                  htmlFor="npwp"
                  hint="Nomor Pokok Wajib Pajak badan usaha Anda."
                >
                  <Input
                    id="npwp"
                    className="max-w-xs tabular-nums"
                    inputMode="numeric"
                    defaultValue="09.254.294.3-541.000"
                    disabled={!ppnAktif}
                  />
                </Field>

                <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Harga sudah termasuk pajak</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Harga produk yang ditampilkan sudah termasuk PPN.
                    </p>
                  </div>
                  <Switch
                    checked={ppnInclusive}
                    onCheckedChange={setPpnInclusive}
                    disabled={!ppnAktif}
                  />
                </div>

                <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Inclusive</span>{" "}
                    — PPN sudah termasuk di dalam harga yang ditampilkan (harga
                    tidak bertambah saat checkout).
                  </p>
                  <p className="mt-1.5">
                    <span className="font-medium text-foreground">Exclusive</span>{" "}
                    — PPN dihitung terpisah dan ditambahkan pada subtotal saat
                    checkout.
                  </p>
                </div>
              </CardContent>
              <SaveFooter />
            </Card>
          )}

          {/* PENGGUNA */}
          {section === "pengguna" && (
            <Card className="max-w-3xl">
              <CardHeader>
                <CardTitle>Pengguna & Peran</CardTitle>
                <CardDescription>
                  Kelola anggota tim yang memiliki akses ke dasbor toko.
                </CardDescription>
                <CardAction>
                  <Button size="sm">
                    <UserPlus />
                    Undang pengguna
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="grid gap-2">
                {team.map((m) => (
                  <div
                    key={m.email}
                    className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 p-3"
                  >
                    <Avatar>
                      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                        {m.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.email}
                      </p>
                    </div>
                    <Badge variant={m.variant}>{m.role}</Badge>
                  </div>
                ))}

                <div className="mt-1 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
                  <p className="mb-1.5 font-medium text-foreground">Peran</p>
                  <ul className="grid gap-1">
                    <li>
                      <span className="font-medium text-foreground">Owner</span> —
                      akses penuh termasuk penagihan & hapus toko.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Admin</span> —
                      kelola produk, pesanan, dan pengaturan.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Staf</span> —
                      akses terbatas untuk operasional harian.
                    </li>
                  </ul>
                </div>
              </CardContent>
              <CardFooter className="justify-end gap-2">
                <p className="mr-auto text-xs text-muted-foreground">
                  <span className="tabular-nums">{team.length}</span> anggota tim
                </p>
                {canSettings ? (
                  <>
                    <Button variant="ghost">Batal</Button>
                    <Button>
                      <Save />
                      Simpan Perubahan
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Hanya Pemilik yang dapat mengelola pengguna.</p>
                )}
              </CardFooter>
            </Card>
          )}

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
