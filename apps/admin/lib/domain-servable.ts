// DOM-3 — proving OWNERSHIP and proving the domain can actually be SERVED are different questions, and
// conflating them is what let `beautyinu.co` sit at `provisioning` with a green tick while Cloudflare
// refused it ("custom hostname does not CNAME to this zone").
//
// Pure on purpose — no DNS, no db import — so the decision is testable without a network.
//
// ⚠️ NEVER decide this by comparing IP ADDRESSES. `cname.tokophi.cc` is itself Cloudflare-proxied, so
// its A records are Cloudflare's SHARED addresses. A merchant who hand-copies those IPs into an apex A
// record gets byte-identical addresses and is still completely unservable — that is exactly the case
// that fooled us. Only the CNAME chain carries the proof.

export const normaliseHost = (h: string): string => h.trim().toLowerCase().replace(/\.$/, "");

/** Does a resolved CNAME chain actually land on our target? */
export const chainReachesTarget = (chain: readonly string[], target: string): boolean => {
  const t = normaliseHost(target);
  return !!t && chain.some((c) => normaliseHost(c) === t);
};

export type ServableVerdict =
  | { servable: true }
  | { servable: false; kind: "no-cname" | "wrong-target"; message: string };

/**
 * `chain` is what DNS returned for the host's CNAME.
 *
 * ⚠️ An EMPTY chain is UNDECIDABLE from here, not wrong — and treating it as wrong was a bug that
 * blocked a correctly-configured merchant. An APEX cannot hold a literal CNAME (RFC 1034: the apex
 * already carries SOA/NS), so providers publish ANAME/ALIAS/CNAME-flattening, which resolves as plain
 * A records — **byte-identical to the hand-copied-IP mistake** from the outside. `beautyinu.co` sat
 * `active` at Cloudflare while this verdict told its owner to do something impossible ("hapus data
 * A/IP-nya, arahkan CNAME") — the merchant had done everything right.
 *
 * So `no-cname` means "DNS cannot prove it either way — let Cloudflare decide": Cloudflare validates
 * against what actually RESOLVES, so a flattened apex goes active and a copied-IP setup never does.
 * Only `wrong-target` — a CNAME that demonstrably points somewhere else — is a hard refusal.
 */
export const servableVerdict = (chain: readonly string[], target: string): ServableVerdict => {
  if (chain.length === 0)
    return {
      servable: false,
      kind: "no-cname",
      message:
        `Belum terbaca CNAME. Subdomain (mis. www): arahkan CNAME ke ${target}. ` +
        `Domain utama (apex) tidak bisa CNAME — pakai ANAME/ALIAS/CNAME flattening ke ${target}. ` +
        `Jika sudah, aktivasi berlanjut otomatis; menyalin alamat IP secara manual tidak bisa dipakai.`,
    };
  if (!chainReachesTarget(chain, target))
    return {
      servable: false,
      kind: "wrong-target",
      message: `CNAME mengarah ke ${normaliseHost(chain[0]!)}, bukan ke ${target}.`,
    };
  return { servable: true };
};
