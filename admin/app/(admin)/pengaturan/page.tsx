"use client"

import * as React from "react"
import {
  Banknote,
  CreditCard,
  Landmark,
  QrCode,
  Truck,
  Wallet,
  HandCoins,
  Store,
  UserPlus,
  Save,
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
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

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
  const [kurir, setKurir] = React.useState({
    jne: true,
    jnt: true,
    sicepat: true,
    anteraja: false,
    pos: false,
    gosend: true,
    grab: false,
  })
  const [gratisOngkir, setGratisOngkir] = React.useState(true)

  // Pajak
  const [ppnAktif, setPpnAktif] = React.useState(true)
  const [ppnInclusive, setPpnInclusive] = React.useState(false)

  const setPayKey = (k: keyof typeof pay) => (v: boolean) =>
    setPay((s) => ({ ...s, [k]: v }))
  const setKurirKey = (k: keyof typeof kurir) => (v: boolean) =>
    setKurir((s) => ({ ...s, [k]: v }))

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

      <Tabs defaultValue="profil">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="profil">Profil Toko</TabsTrigger>
          <TabsTrigger value="pembayaran">Pembayaran</TabsTrigger>
          <TabsTrigger value="pengiriman">Pengiriman</TabsTrigger>
          <TabsTrigger value="pajak">Pajak</TabsTrigger>
          <TabsTrigger value="pengguna">Pengguna</TabsTrigger>
        </TabsList>

        {/* PROFIL TOKO */}
        <TabsContent value="profil" className="mt-5">
          <Card className="mx-auto max-w-3xl">
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
        </TabsContent>

        {/* PEMBAYARAN */}
        <TabsContent value="pembayaran" className="mt-5">
          <Card className="mx-auto max-w-3xl">
            <CardHeader>
              <CardTitle>Metode Pembayaran</CardTitle>
              <CardDescription>
                Aktifkan metode pembayaran yang tersedia untuk pelanggan Anda.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
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
        </TabsContent>

        {/* PENGIRIMAN */}
        <TabsContent value="pengiriman" className="mt-5">
          <Card className="mx-auto max-w-3xl">
            <CardHeader>
              <CardTitle>Kurir Pengiriman</CardTitle>
              <CardDescription>
                Pilih jasa kurir yang dapat dipilih pelanggan saat checkout.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <ToggleRow
                icon={<Truck />}
                title="JNE"
                description="Reguler, YES, OKE"
                checked={kurir.jne}
                onCheckedChange={setKurirKey("jne")}
              />
              <ToggleRow
                icon={<Truck />}
                title="J&T Express"
                description="Reguler & ekonomi"
                checked={kurir.jnt}
                onCheckedChange={setKurirKey("jnt")}
              />
              <ToggleRow
                icon={<Truck />}
                title="SiCepat"
                description="REG, BEST, GOKIL"
                checked={kurir.sicepat}
                onCheckedChange={setKurirKey("sicepat")}
              />
              <ToggleRow
                icon={<Truck />}
                title="AnterAja"
                description="Reguler & same day"
                checked={kurir.anteraja}
                onCheckedChange={setKurirKey("anteraja")}
              />
              <ToggleRow
                icon={<Truck />}
                title="Pos Indonesia"
                description="Kilat khusus & reguler"
                checked={kurir.pos}
                onCheckedChange={setKurirKey("pos")}
              />
              <ToggleRow
                icon={<Truck />}
                title="GoSend (instan)"
                description="Pengiriman instan dalam kota"
                checked={kurir.gosend}
                onCheckedChange={setKurirKey("gosend")}
              />
              <ToggleRow
                icon={<Truck />}
                title="GrabExpress"
                description="Same day & instant"
                checked={kurir.grab}
                onCheckedChange={setKurirKey("grab")}
              />

              <Separator className="my-1" />

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
                      className="w-40 pl-8"
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
        </TabsContent>

        {/* PAJAK */}
        <TabsContent value="pajak" className="mt-5">
          <Card className="mx-auto max-w-3xl">
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
                  className="max-w-40"
                  inputMode="numeric"
                  defaultValue="11"
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
            </CardContent>
            <SaveFooter />
          </Card>
        </TabsContent>

        {/* PENGGUNA */}
        <TabsContent value="pengguna" className="mt-5">
          <Card className="mx-auto max-w-3xl">
            <CardHeader>
              <CardTitle>Pengguna & Peran</CardTitle>
              <CardDescription>
                Kelola anggota tim yang memiliki akses ke dasbor toko.
              </CardDescription>
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
            </CardContent>
            <CardFooter className="justify-between">
              <p className="text-xs text-muted-foreground">
                {team.length} anggota tim
              </p>
              <Button>
                <UserPlus />
                Undang pengguna
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
