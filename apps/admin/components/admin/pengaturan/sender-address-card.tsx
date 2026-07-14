"use client";
import * as React from "react";
import { toast } from "sonner";
import { MapPin, Search, Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Button } from "@tokophi/ui/button";
import { getSenderAddress, saveSenderAddress, searchArea, listKelurahan } from "@/lib/actions/shipping";
import { composeAddress } from "@/lib/address";

type Kel = { id: number; name: string; postalCode: string };

// Sender / pickup address used to create shipments (origin). Platform-managed couriers still apply;
// this is only the store's own pickup point.
//
// The picker is two steps — kecamatan, then kelurahan — because a kecamatan is not an address. It is
// a district that can span a dozen villages, and the courier books the pickup against the village id
// plus the kodepos. Picking only the kecamatan is how a driver ends up in the right district and the
// wrong street. The village list comes from the courier's own API, so its id is one the booking will
// actually accept; the kodepos is DEFAULTED from the picked village and then left editable, because a
// kelurahan can span more than one and the merchant knows theirs.
export function SenderAddressCard() {
  const [loaded, setLoaded] = React.useState(false);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [kecId, setKecId] = React.useState<number | null>(null);
  const [kecName, setKecName] = React.useState("");
  const [kelId, setKelId] = React.useState<number | null>(null);
  const [kelName, setKelName] = React.useState("");
  const [zip, setZip] = React.useState("");
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<{ id: number; text: string }[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [villages, setVillages] = React.useState<Kel[] | null>(null);
  const [loadingVillages, setLoadingVillages] = React.useState(false);
  const [villageQ, setVillageQ] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    getSenderAddress().then((s) => {
      if (s) {
        setName(s.name); setPhone(s.phone); setAddress(s.address);
        setKecId(s.kecamatanId); setKecName(s.kecamatanName);
        setKelId(s.kelurahanId); setKelName(s.kelurahanName);
        setZip(s.zip);
      }
      setLoaded(true);
    });
  }, []);

  // The village list belongs to the kecamatan, so it is fetched when one is chosen — including on
  // load, so a merchant who already saved a kecamatan can pick (or change) their village without
  // having to re-search the district first.
  const loadVillages = React.useCallback(async (id: number) => {
    setLoadingVillages(true);
    try {
      setVillages(await listKelurahan(id));
    } finally {
      setLoadingVillages(false);
    }
  }, []);

  React.useEffect(() => {
    if (kecId) void loadVillages(kecId);
    else setVillages(null);
  }, [kecId, loadVillages]);

  const doSearch = async () => {
    if (!q.trim()) return;
    setSearching(true);
    setResults(await searchArea(q));
    setSearching(false);
  };

  const pickKecamatan = (r: { id: number; text: string }) => {
    setKecId(r.id); setKecName(r.text); setResults([]); setQ("");
    // A village from the PREVIOUS district is not a village of this one — clear it, and the kodepos
    // with it, rather than carry a stale id into a booking.
    setKelId(null); setKelName(""); setZip(""); setVillageQ("");
  };

  const clearKecamatan = () => {
    setKecId(null); setKecName("");
    setKelId(null); setKelName(""); setZip(""); setVillages(null); setVillageQ("");
  };

  const pickVillage = (v: Kel) => {
    setKelId(v.id); setKelName(v.name);
    setZip(v.postalCode || ""); // default, editable below
    setVillageQ("");
  };

  const save = () =>
    startTransition(async () => {
      const r = await saveSenderAddress({
        name, phone, address,
        kecamatanId: kecId, kecamatanName: kecName,
        kelurahanId: kelId, kelurahanName: kelName,
        zip,
      });
      if (r.ok) toast.success("Alamat pengirim disimpan.");
      else toast.error(r.error ?? "Gagal menyimpan.");
    });

  const shown = villageQ.trim()
    ? (villages ?? []).filter((v) => v.name.toLowerCase().includes(villageQ.trim().toLowerCase()))
    : (villages ?? []);

  // What the courier will actually be handed. Showing it back closes the loop: the merchant can see
  // that the address they assembled is the address that gets printed, instead of trusting four fields.
  // Same composer createShipment uses (lib/address.ts) — including its de-duplication, so the readback
  // is the string, not an approximation of it.
  const fullAddress = composeAddress([address, kelName, kecName]) + (zip ? ` ${zip}` : "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" /> Alamat Pengirim</CardTitle>
        <CardDescription>Titik jemput toko — dipakai kurir saat menjemput paket.</CardDescription>
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
          <Input id="s-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Jl. …, RT/RW, patokan" disabled={!loaded} />
        </div>

        {/* Step 1 — kecamatan */}
        <div className="space-y-1.5">
          <Label>Kecamatan</Label>
          {kecName ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/30">
              <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="truncate">{kecName}</span>
              <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-foreground" onClick={clearKecamatan}>ubah</button>
            </div>
          ) : (
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
                    <button type="button" key={r.id} onClick={() => pickKecamatan(r)} className="block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted">
                      {r.text}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Step 2 — kelurahan (only once a kecamatan exists; it is a list *of* that kecamatan) */}
        {kecId && (
          <div className="space-y-1.5">
            <Label>Kelurahan / desa</Label>
            {kelName ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/30">
                <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="truncate">{kelName}</span>
                <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-foreground" onClick={() => { setKelId(null); setKelName(""); }}>ubah</button>
              </div>
            ) : loadingVillages ? (
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Memuat daftar kelurahan…
              </div>
            ) : villages && villages.length > 0 ? (
              <>
                {villages.length > 8 && (
                  <Input value={villageQ} onChange={(e) => setVillageQ(e.target.value)} placeholder="Saring kelurahan…" />
                )}
                <div className="max-h-48 overflow-y-auto rounded-md border">
                  {shown.map((v) => (
                    <button type="button" key={v.id} onClick={() => pickVillage(v)} className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted">
                      <span className="truncate">{v.name}</span>
                      {v.postalCode && <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{v.postalCode}</span>}
                    </button>
                  ))}
                  {shown.length === 0 && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">Tidak ada kelurahan yang cocok.</p>
                  )}
                </div>
              </>
            ) : (
              // An empty list is a fact about the data, not a failure of the merchant. Say so, and let
              // them save anyway: the kelurahan is optional to the courier, the kodepos is not guessed.
              <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                Daftar kelurahan tidak tersedia untuk kecamatan ini. Lewati saja — isi kode pos secara manual di bawah.
              </p>
            )}
          </div>
        )}

        {/* Kodepos — defaulted from the picked kelurahan, always editable */}
        <div className="space-y-1.5 sm:max-w-[12rem]">
          <Label htmlFor="s-zip">Kode pos</Label>
          <Input
            id="s-zip" value={zip} inputMode="numeric" maxLength={5}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
            placeholder="55281" disabled={!loaded}
            className="tabular-nums"
          />
        </div>

        {/* The resolved address, read back */}
        {kecName && address.trim() && (
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">Alamat jemput yang dipakai kurir</p>
            <p className="text-sm">{fullAddress}</p>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={save} disabled={pending || !loaded || !kecId}>{pending ? "Menyimpan…" : "Simpan alamat"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
