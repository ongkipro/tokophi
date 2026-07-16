// The ONE place the store's pickup address string is composed.
//
// Pure + client-safe on purpose (no "use server", no "server-only"): the booking builds the address
// it sends to KiriminAja from this, and the Seller's Alamat Pengirim card previews it from the SAME
// function. Two copies would drift, and the drift would be invisible — the seller would be shown one
// address while the rider was handed another.
//
// WHY the kelurahan and the postcode live INSIDE the address string: KiriminAja's `request_pickup`
// identifies the sender by `kecamatan_id` (+ an optional `kelurahan_id` in THEIR numbering, which we
// never send — ours are Kemendagri codes) and a free-text `address`. There is NO sender zipcode field
// (`destination_zipcode` is the buyer's). So this string is the only way either value reaches the
// rider who actually collects the parcel.

export type PickupParts = {
  address?: string | null;
  kelurahanName?: string | null;
  postcode?: string | null;
};

/** `"Jl. Melati 12, Kel. Gubeng, 60281"` — what the courier rider reads. Kecamatan is NOT in here:
 *  it travels as `kecamatan_id`, which is the field the courier routes on. */
export function composePickupAddress(p: PickupParts): string {
  const kel = (p.kelurahanName ?? "").trim();
  return [
    (p.address ?? "").trim(),
    kel ? `Kel. ${kel}` : "",
    (p.postcode ?? "").trim(),
  ]
    .filter(Boolean)
    .join(", ");
}
