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

export type ServableVerdict = { servable: true } | { servable: false; message: string };

/**
 * `chain` is what DNS returned for the host's CNAME. An EMPTY chain is the important case: it means the
 * host has A records instead (or nothing), which is the hand-copied-IP mistake and is NOT servable.
 */
export const servableVerdict = (chain: readonly string[], target: string): ServableVerdict => {
  if (chain.length === 0)
    return {
      servable: false,
      message: `Domain ini belum memakai CNAME. Hapus data A/IP-nya, lalu arahkan CNAME ke ${target}. Menyalin alamat IP tidak bisa dipakai.`,
    };
  if (!chainReachesTarget(chain, target))
    return {
      servable: false,
      message: `CNAME mengarah ke ${normaliseHost(chain[0]!)}, bukan ke ${target}.`,
    };
  return { servable: true };
};
