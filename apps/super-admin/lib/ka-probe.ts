import type { KaTestResult } from "@tokophi/lib/kiriminaja";

// Task 8.3 — the KiriminAja health state on Super Admin → Pengaturan.
//
// PURE, no DB and no fetch (the same split as `platform-rank.ts`), so the four states can be pinned
// by a test without calling the vendor. The facts come from `kaTestConnection`; the CACHED call that
// produces them lives in `data.ts` (`getKiriminajaProbe`).
//
// Why four states and not a boolean: `SystemStatus.kiriminaja` used to be `kiriminajaConfigured()`
// — "the env key is non-empty" — and it read GREEN for the whole of 2026-09-07 while the sandbox
// answered 401 "Your IP address 45.77.33.112 were not allowed to access this API" and no order could
// be placed. "Refused" (the vendor answered and said no — usually the IP allow-list, which lapses)
// and "unreachable" (nothing parseable came back within the timeout) need DIFFERENT people: the
// first is fixed in the KiriminAja dashboard, the second on our side or theirs. Collapsing them into
// "Tidak terhubung" is what the task explicitly forbids.

export type KaProbeState = "ok" | "refused" | "unreachable" | "unconfigured";

export type KaProbeVerdict = {
  state: KaProbeState;
  /** The WORD beside the glyph — a verdict is never carried by colour alone (WCAG 1.4.1). */
  word: string;
  /** What the operator acts on: the vendor's own sentence on a refusal, verbatim. */
  detail: string;
  env: string;
};

const WORD: Record<KaProbeState, string> = {
  ok: "Terhubung",
  refused: "Ditolak",
  unreachable: "Tidak terjangkau",
  unconfigured: "Belum dikonfigurasi",
};

export function classifyKaProbe(r: KaTestResult): KaProbeVerdict {
  if (!r.configured) return { state: "unconfigured", word: WORD.unconfigured, detail: "KIRIMINAJA_API_KEY kosong — tidak ada yang dipanggil.", env: r.env };
  if (r.ok) return { state: "ok", word: WORD.ok, detail: `${r.provinces ?? 0} provinsi`, env: r.env };
  // A parseable `{status:false}` is the vendor speaking. Keep its words: the allow-list refusal
  // names the IP that must be re-added, and nothing else on any screen does.
  if (r.text !== undefined) return { state: "refused", word: WORD.refused, detail: `HTTP ${r.httpStatus ?? "?"}: ${r.text}`, env: r.env };
  return { state: "unreachable", word: WORD.unreachable, detail: r.message, env: r.env };
}

/** The probe result the page renders: the verdict plus WHEN it was measured (epoch ms). */
export type KaProbe = KaProbeVerdict & { probedAt: number };
