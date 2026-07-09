"use client";
import * as React from "react";
import { toast } from "sonner";
import { MapPin, Search, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { getSenderAddress, saveSenderAddress, searchArea } from "@/lib/actions/shipping";

// Sender / pickup address used to create KiriminAja shipments (origin). Platform-managed
// couriers still apply; this is only the store's own pickup point.
export function SenderAddressCard() {
  const [loaded, setLoaded] = React.useState(false);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [kecId, setKecId] = React.useState<number | null>(null);
  const [kecName, setKecName] = React.useState("");
  const [lat, setLat] = React.useState("");
  const [lng, setLng] = React.useState("");
  const [locating, setLocating] = React.useState(false);
  const useCurrentLocation = () => {
    if (!navigator.geolocation) { toast.error("Browser tidak mendukung lokasi."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude.toFixed(6)); setLng(pos.coords.longitude.toFixed(6)); setLocating(false); toast.success("Koordinat diisi dari lokasi."); },
      () => { setLocating(false); toast.error("Izin lokasi ditolak."); },
    );
  };
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<{ id: number; text: string }[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    getSenderAddress().then((s) => {
      if (s) {
        setName(s.name); setPhone(s.phone); setAddress(s.address);
        setKecId(s.kecamatanId); setKecName(s.kecamatanName); setLat(s.lat); setLng(s.lng);
      }
      setLoaded(true);
    });
  }, []);

  const doSearch = async () => {
    if (!q.trim()) return;
    setSearching(true);
    setResults(await searchArea(q));
    setSearching(false);
  };
  const pick = (r: { id: number; text: string }) => {
    setKecId(r.id); setKecName(r.text); setResults([]); setQ("");
  };
  const save = () =>
    startTransition(async () => {
      const r = await saveSenderAddress({ name, phone, address, kecamatanId: kecId, kecamatanName: kecName, lat, lng });
      if (r.ok) toast.success("Alamat pengirim disimpan.");
      else toast.error(r.error ?? "Gagal menyimpan.");
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" /> Alamat Pengirim (KiriminAja)</CardTitle>
        <CardDescription>Titik jemput toko — dipakai KiriminAja saat membuat pengiriman (resi/AWB).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="s-name">Nama pengirim</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama toko / gudang" disabled={!loaded} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-phone">No. HP pengirim</Label>
            <Input id="s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812…" disabled={!loaded} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-addr">Alamat lengkap</Label>
          <Input id="s-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Jl. …" disabled={!loaded} />
        </div>
        <div className="space-y-1.5">
          <Label>Kecamatan (area KiriminAja)</Label>
          {kecName && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/30">
              <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="truncate">{kecName}</span>
              <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-foreground" onClick={() => { setKecId(null); setKecName(""); }}>ubah</button>
            </div>
          )}
          {!kecName && (
            <>
              <div className="flex gap-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), doSearch())} placeholder="Cari kecamatan / kota…" disabled={!loaded} />
                <Button type="button" variant="outline" onClick={doSearch} disabled={searching || !q.trim()}>
                  <Search className="size-4" /> {searching ? "Cari…" : "Cari"}
                </Button>
              </div>
              {results.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-md border">
                  {results.map((r) => (
                    <button type="button" key={r.id} onClick={() => pick(r)} className="block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted">
                      {r.text}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Titik koordinat <span className="font-normal text-muted-foreground">(untuk kirim instan)</span></Label>
            <Button type="button" variant="outline" size="sm" disabled={!loaded || locating} onClick={useCurrentLocation}>
              <MapPin className="size-3.5" /> {locating ? "Mengambil…" : "Gunakan lokasi saat ini"}
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-lat" className="text-xs text-muted-foreground">Latitude</Label>
              <Input id="s-lat" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-7.79" disabled={!loaded} className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-lng" className="text-xs text-muted-foreground">Longitude</Label>
              <Input id="s-lng" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="110.36" disabled={!loaded} className="tabular-nums" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Diambil dari lokasi perangkat di toko. Dipakai kurir <b>instan</b> (GoSend/Grab) untuk titik jemput.</p>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending || !loaded || !kecId}>{pending ? "Menyimpan…" : "Simpan alamat"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
