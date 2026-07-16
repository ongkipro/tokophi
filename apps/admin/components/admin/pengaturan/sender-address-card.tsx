"use client";
import * as React from "react";
import { toast } from "sonner";
import { MapPin, Search, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Button } from "@tokophi/ui/button";
import { getSenderAddress, saveSenderAddress, searchArea, kelurahanOptions } from "@/lib/actions/shipping";

// Sender / pickup address used to create KiriminAja shipments (origin). Platform-managed
// couriers still apply; this is only the store's own pickup point.
export function SenderAddressCard() {
  const [loaded, setLoaded] = React.useState(false);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [kecId, setKecId] = React.useState<number | null>(null);
  const [kecName, setKecName] = React.useState("");
  const [kelName, setKelName] = React.useState("");
  // Postcode follows the chosen kelurahan (it is not typed). Kept in state rather than derived, so the
  // saved value still shows on load, before the kelurahan option list has come back.
  const [postcode, setPostcode] = React.useState("");
  const [kelOptions, setKelOptions] = React.useState<{ name: string; postcode: string }[]>([]);
  const [kelLoading, setKelLoading] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<{ id: number; text: string }[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    getSenderAddress().then((s) => {
      if (s) {
        setName(s.name); setPhone(s.phone); setAddress(s.address);
        setKecId(s.kecamatanId); setKecName(s.kecamatanName);
        setKelName(s.kelurahanName ?? "");
        setPostcode(s.postcode ?? "");
      }
      setLoaded(true);
    });
  }, []);

  // The kelurahan list follows the district. ~4% of districts have no kelurahan rows at all, and
  // there the field must not become a required dropdown with nothing in it — the seller writes it
  // into the address instead. An empty required control is a dead end, not a validation.
  React.useEffect(() => {
    if (!kecId) { setKelOptions([]); return; }
    let alive = true;
    setKelLoading(true);
    kelurahanOptions(kecId).then((rows) => {
      if (!alive) return;
      setKelOptions(rows);
      setKelLoading(false);
    });
    return () => { alive = false; };
  }, [kecId]);

  const doSearch = async () => {
    if (!q.trim()) return;
    setSearching(true);
    setResults(await searchArea(q));
    setSearching(false);
  };
  const pick = (r: { id: number; text: string }) => {
    setKecId(r.id); setKecName(r.text); setResults([]); setQ("");
    setKelName(""); setPostcode(""); // a kelurahan (and its postcode) belongs to its district
  };
  // The postcode is never typed — it comes from the kelurahan the seller picked.
  const pickKelurahan = (nextName: string) => {
    setKelName(nextName);
    setPostcode(kelOptions.find((k) => k.name === nextName)?.postcode ?? "");
  };
  const save = () =>
    startTransition(async () => {
      // kelurahanId stays null on purpose — see the comment on the field. We only carry the NAME
      // (+ its postcode); both ride in the written pickup address the courier rider reads.
      const r = await saveSenderAddress({ name, phone, address, kecamatanId: kecId, kecamatanName: kecName, kelurahanName: kelName, postcode });
      if (r.ok) toast.success("Alamat pengirim disimpan.");
      else toast.error(r.error ?? "Gagal menyimpan.");
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" /> Alamat Pengirim</CardTitle>
        <CardDescription>Titik jemput toko — dipakai saat membuat pengiriman (resi/AWB).</CardDescription>
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
          <Label>Kecamatan (area pengiriman)</Label>
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

        {/* Kelurahan — precision for the rider who collects the parcel.
            ⚠️ It is stored as a NAME, not as an id, and that is deliberate. KiriminAja's booking
            takes a `kelurahan_id` from THEIR OWN numbering, and their address API only knows
            kecamatan: searching "Airlangga" (a kelurahan inside Gubeng) returns "Not found".
            Our `kelurahan` table is Kemendagri data with TEXT codes ("11.01.01.2001"). Writing one
            of those into `sender_kelurahan_id` would send the courier a foreign id that looks
            valid — wrong data wearing the costume of right data. So we send the kecamatan id (which
            IS theirs) and put the kelurahan in the written address the rider actually reads. */}
        {kecId && (
          <div className="space-y-1.5">
            <Label htmlFor="s-kel">
              Kelurahan / Desa {kelOptions.length === 0 && <span className="text-xs font-normal text-muted-foreground">(tidak tersedia untuk kecamatan ini)</span>}
            </Label>
            {kelOptions.length > 0 ? (
              <select
                id="s-kel"
                value={kelName}
                onChange={(e) => pickKelurahan(e.target.value)}
                disabled={!loaded || kelLoading}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <option value="">{kelLoading ? "Memuat…" : "Pilih kelurahan…"}</option>
                {kelOptions.map((k) => (
                  <option key={k.name} value={k.name}>
                    {k.name} — {k.postcode}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-muted-foreground">
                Data kelurahan belum tersedia untuk kecamatan ini — tulis saja di Alamat lengkap.
              </p>
            )}
            {postcode && (
              <p className="text-xs text-muted-foreground">
                Kode pos: <span className="font-mono font-medium text-foreground">{postcode}</span>{" "}
                <span className="text-muted-foreground">(mengikuti kelurahan)</span>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Kelurahan &amp; kode pos ikut ditulis di alamat jemput yang dibaca kurir. Kurir memakai kecamatan untuk rute; kelurahan mempertajam titik jemputnya.
            </p>
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending || !loaded || !kecId}>{pending ? "Menyimpan…" : "Simpan alamat"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
