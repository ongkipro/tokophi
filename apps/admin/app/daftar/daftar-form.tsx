"use client";
import * as React from "react";
import { useActionState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { registerStore } from "@/lib/actions/register";
import { slugify } from "@tokophi/lib/store-slug";
import { STORE_NAME_EVENT } from "@/components/admin/front-door/address-plate";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { GoogleButton } from "./google-button";

const STEPS = ["Buat akun", "Profil pemilik", "Alamat penjemputan"] as const;

/**
 * Signup, in three steps — and only the FIRST one is required.
 *
 * ── WHY MORE THAN A NAME AND A PASSWORD ─────────────────────────────────────────────────────────
 *
 * `store_settings.sender_kecamatan_id` is what prices every shipment this shop will ever quote
 * (`lib/shipping-quote.ts`). A store with none falls back to its registered CITY, fuzzy-matched, and
 * the response says so (`originFrom: "store-city"`) — a Surabaya merchant quoting Yogyakarta rates
 * until they happen to find Pengaturan → Alamat. Collecting it here is the difference between a shop
 * that prices correctly on day one and one that silently does not.
 *
 * It cannot be collected AFTER signup either: a new shop is created suspended pending review (0090),
 * so the panel is read-only until an operator approves it. A "finish your profile" checklist would
 * be a checklist nobody could fill in.
 *
 * ── WHY THE LAST TWO STEPS ARE SKIPPABLE ────────────────────────────────────────────────────────
 *
 * A long form in front of the door is the surest way to lose the sale — the rule this repo already
 * applies to checkout ("over-validation is itself a bug"). Step ① alone creates the shop. Steps ②
 * and ③ can be skipped and are then simply NULL, exactly as every signup produced before this
 * change; the seller completes them in Pengaturan → Alamat, and nothing is worse than it was.
 *
 * ⚠️ ALL FIELDS STAY MOUNTED, hidden with CSS rather than unmounted, so one submit carries the whole
 * wizard in ONE FormData and the shop is created in ONE transaction. Unmounting the earlier steps
 * would drop their values, and splitting the submit would mean a signup that can fail at step ③
 * after the account already exists — leaving someone who typed an address with nothing to show.
 * Only steps ①/② carry `required`, and `next()` refuses to walk past an invalid one, so a hidden
 * required field can never block the submit with an error pointing at something off screen.
 */
export function DaftarForm({ googleEnabled, notice }: { googleEnabled: boolean; notice?: string }) {
  const [state, action, pending] = useActionState(registerStore, {});
  const [step, setStep] = React.useState(0);
  const [storeName, setStoreName] = React.useState("");
  const [stepError, setStepError] = React.useState<string | null>(null);
  const stepRef = React.useRef<HTMLDivElement>(null);

  // Pickup address (step ③) — the same cascade the shopper's checkout uses, through the same public
  // endpoint (`/api/public/ongkir`, ops `search` + `kelurahan`). Same origin as this page, already
  // rate-limited and body-capped, and the platform's courier key never leaves the server. A second
  // lookup route would have been a second public surface to guard.
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<{ id: number; text: string }[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [searched, setSearched] = React.useState(false);
  const [kec, setKec] = React.useState<{ id: number; text: string } | null>(null);
  const [kelOptions, setKelOptions] = React.useState<{ name: string; postcode: string }[]>([]);
  const [kel, setKel] = React.useState("");
  const [postcode, setPostcode] = React.useState("");

  const slug = slugify(storeName);

  const api = async (body: Record<string, unknown>) => {
    try {
      const r = await fetch("/api/public/ongkir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return r.ok ? await r.json() : null;
    } catch {
      return null; // a failed lookup must not break the signup — steps ②/③ are optional
    }
  };

  const doSearch = async () => {
    if (!q.trim()) return;
    setSearching(true);
    const res = await api({ op: "search", q: q.trim() });
    setResults(res?.results ?? []);
    setSearched(true);
    setSearching(false);
  };

  const pickKecamatan = async (r: { id: number; text: string }) => {
    setKec(r);
    setResults([]);
    setQ("");
    setKel("");
    setPostcode("");
    // ⚠️ ~4% of districts have no kelurahan rows at all. There the select stays empty and the kodepos
    // must remain TYPEABLE — an empty required dropdown is a dead end, not a validation. The same
    // rule the checkout learned.
    const res = await api({ op: "kelurahan", destinationId: r.id });
    // The route answers under `kelurahan` (rows are `{name, postcode}`); no second guess.
    setKelOptions(res?.kelurahan ?? []);
  };

  const pickKelurahan = (name: string) => {
    setKel(name);
    const hit = kelOptions.find((k) => k.name === name);
    if (hit?.postcode) setPostcode(hit.postcode);
  };

  // Advance only when the CURRENT step's own controls are valid — `checkValidity()` scoped to the
  // step's container, so step ① cannot be walked past empty while its inputs sit hidden two steps on.
  const next = () => {
    const invalid = stepRef.current?.querySelector<HTMLInputElement>(":invalid");
    if (invalid) {
      setStepError(invalid.validationMessage || "Lengkapi kolom di atas dulu.");
      invalid.focus();
      return;
    }
    setStepError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  return (
    <div className="flex flex-col gap-4">
      {googleEnabled && step === 0 && (
        <>
          <GoogleButton mode="daftar" label="Daftar dengan Google" />
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">atau</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      {/* Where they are and how much is left. */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 flex-col gap-1">
            <span className={`h-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`} />
            <span className={`text-[11px] ${i === step ? "font-medium text-foreground" : "text-muted-foreground"}`}>{label}</span>
          </div>
        ))}
      </div>

      <form action={action} className="flex flex-col gap-4">
        {/* ── ① account ─────────────────────────────────────────────────────────────────────── */}
        <div ref={step === 0 ? stepRef : undefined} className={`flex flex-col gap-4 ${step === 0 ? "" : "hidden"}`}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="storeName">Nama toko</Label>
            <Input
              id="storeName"
              name="storeName"
              required
              minLength={3}
              maxLength={60}
              placeholder="Batik Nusantara"
              autoComplete="organization"
              className="h-11"
              value={storeName}
              onChange={(e) => {
                setStoreName(e.target.value);
                // Platnya ada di KOLOM LAIN (panel kanan), cabang React yang berbeda. Satu event
                // jauh lebih murah daripada mengangkat state ke atas dan mengubah seluruh pintu
                // depan jadi client component — lihat alasannya di `address-plate.tsx`.
                window.dispatchEvent(new CustomEvent(STORE_NAME_EVENT, { detail: e.target.value }));
              }}
            />
            {/* The shop's permanent public address, derived by the SAME rule the server uses
                (`@tokophi/lib/store-slug`), so the preview cannot promise an address the server would
                spell differently — "Café Senja" → `cafe-senja`, never `caf-senja`. */}
            {/* Di ≥lg plat di panel kanan yang memegang peran ini; di bawah itu panelnya disembunyikan,
                jadi preview-nya harus tetap ada di sini. Bukan duplikasi — dua viewport, satu peran. */}
            <p className="font-mono text-xs text-muted-foreground lg:hidden">
              {slug || "nama-toko"}<span className="text-muted-foreground/60">.tokophi.id</span>
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required placeholder="nama@toko.id" autoComplete="email" className="h-11" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Kata sandi</Label>
            <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="h-11" />
            <p className="text-xs text-muted-foreground">Minimal 8 karakter.</p>
          </div>
        </div>

        {/* ── ② owner profile ───────────────────────────────────────────────────────────────── */}
        <div ref={step === 1 ? stepRef : undefined} className={`flex flex-col gap-4 ${step === 1 ? "" : "hidden"}`}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ownerName">Nama lengkap</Label>
            <Input id="ownerName" name="ownerName" required maxLength={60} placeholder="Nama lengkap Anda" autoComplete="name" className="h-11" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ownerPhone">WhatsApp</Label>
            <Input id="ownerPhone" name="ownerPhone" type="tel" inputMode="numeric" placeholder="0812xxxxxxx" autoComplete="tel" className="h-11" />
            <p className="text-xs text-muted-foreground">Dipakai kurir saat menjemput paket. Bisa diisi nanti.</p>
          </div>
        </div>

        {/* ── ③ pickup address ──────────────────────────────────────────────────────────────── */}
        <div ref={step === 2 ? stepRef : undefined} className={`flex flex-col gap-4 ${step === 2 ? "" : "hidden"}`}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="kecamatan-q">Kecamatan</Label>
            {kec ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <span className="flex items-center gap-2"><Check className="size-4 text-emerald-600" /> {kec.text}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setKec(null)}>Ganti</Button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    id="kecamatan-q"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }}
                    placeholder="Ketik nama kecamatan, mis. Gubeng"
                  />
                  <Button type="button" variant="outline" disabled={searching} onClick={doSearch}>
                    {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  </Button>
                </div>
                {/* ⚠️ `resolveArea` matches ONE term — a district name OR a city name, not both. A
                    two-word query like "Depok Sleman" comes back empty, so the placeholder must not
                    teach that shape and a zero-result answer has to say what to do instead. Measured:
                    "Depok Sleman" → 0 results, "Sleman" → 17, "Gubeng" → 1. */}
                {searched && results.length === 0 && !searching && (
                  <p className="text-xs text-muted-foreground">
                    Tidak ditemukan. Coba <b>satu kata</b> saja — nama kecamatan (mis. “Gubeng”) atau nama kota (mis. “Sleman”).
                  </p>
                )}
                {results.length > 0 && (
                  <ul className="max-h-44 overflow-auto rounded-lg border text-sm">
                    {results.map((r) => (
                      <li key={r.id}>
                        <button type="button" className="w-full px-3 py-2 text-left hover:bg-muted" onClick={() => pickKecamatan(r)}>
                          {r.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {kec && kelOptions.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="kelurahan">Kelurahan / desa</Label>
              <select
                id="kelurahan"
                className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
                value={kel}
                onChange={(e) => pickKelurahan(e.target.value)}
              >
                <option value="">Pilih kelurahan…</option>
                {kelOptions.map((k) => (
                  <option key={k.name} value={k.name}>{k.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="senderPostcode">Kode pos</Label>
            {/* Filled from the kelurahan and ALWAYS editable — the districts with no kelurahan data
                have to be typed, and a locked field would strand exactly those sellers. */}
            <Input id="senderPostcode" name="senderPostcode" inputMode="numeric" maxLength={5} placeholder="55281" value={postcode} onChange={(e) => setPostcode(e.target.value)} className="h-11 font-mono" />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="senderAddress">Alamat lengkap</Label>
            <Input id="senderAddress" name="senderAddress" placeholder="Jl. Melati No. 12, RT 03 / RW 05" autoComplete="street-address" className="h-11" />
            <p className="text-xs text-muted-foreground">Titik jemput kurir. Bisa diisi nanti di Pengaturan → Alamat.</p>
          </div>
        </div>

        {/* The picked row's own id and label, carried as hidden fields: a district id cannot be
            mistyped, and it cannot drift from the name shown to the seller. */}
        <input type="hidden" name="senderKecamatanId" value={kec?.id ?? ""} />
        <input type="hidden" name="senderKecamatanName" value={kec?.text ?? ""} />
        <input type="hidden" name="senderKelurahanName" value={kel} />

        {(state?.error || notice || stepError) && (
          <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/8 px-3.5 py-2.5 text-sm text-destructive">
            {state?.error ?? notice ?? stepError}
          </p>
        )}

        <div className="flex gap-2">
          {step > 0 && (
            <Button type="button" variant="ghost" className="h-11" onClick={() => setStep((s) => s - 1)} disabled={pending}>Kembali</Button>
          )}
          {step < STEPS.length - 1 ? (
            <>
              <Button type="button" className="h-11 flex-1 text-[0.9375rem] transition-transform motion-safe:active:scale-[0.985]" onClick={next} disabled={pending}>Lanjut</Button>
              {/* "Lewati" is a SUBMIT, not a jump to the last step: the shop is created with whatever
                  has been filled so far, which is the promise that makes the later steps optional. */}
              {step > 0 && (
                <Button type="submit" variant="outline" className="h-11" disabled={pending}>{pending ? "Membuat…" : "Lewati"}</Button>
              )}
            </>
          ) : (
            <Button type="submit" className="h-11 flex-1 text-[0.9375rem] transition-transform motion-safe:active:scale-[0.985]" disabled={pending}>{pending ? "Membuat toko…" : "Selesai & buat toko"}</Button>
          )}
        </div>

      </form>
    </div>
  );
}
