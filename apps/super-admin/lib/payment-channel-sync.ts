// What "Sync kanal pembayaran" may write — PURE, so it is tested (same split as payout-transition.ts).
//
// `platform_payment_channels` carries two different facts, owned by two different parties:
//   · `active`  — can the PROVIDER take money on this channel? AutoLaris decides; Sync records it.
//   · `enabled` — does the PLATFORM offer it at checkout? The operator decides (owner ruling).
// Sync used to write `enabled = active` for every channel the provider listed. On 2026-09-17 the
// owner switched OVO off ("fokusnya VA + QRIS"); list_payment reports OVO as available, so the next
// Sync switched it back ON — at every checkout — and wrote no audit line, so nothing said who did it.
//
// The rule now:
//   · Sync NEVER turns `enabled` on. Offering a channel is the operator's toggle (savePaymentChannels).
//   · Sync turns `enabled` off when the provider reports a channel inactive — checkout must not offer a
//     channel that cannot take money.
//   · A channel seen for the first time is recorded `enabled = false`, whatever the provider says.
//   · Every row the plan changes is named, so the caller can write the audit line.

export type ExistingChannel = { channel: string; label: string; enabled: boolean; active: boolean };
export type ProbedChannel = { code: string; label: string; kind: string; active: boolean };

export type ChannelWrite =
  | { op: "update"; channel: string; set: { active: boolean; enabled?: false } }
  | { op: "insert"; channel: string; label: string; kind: string; active: boolean; enabled: false };

export type ChannelSyncPlan = { writes: ChannelWrite[]; changes: string[] };

export function planChannelSync(existing: ExistingChannel[], probed: ProbedChannel[]): ChannelSyncPlan {
  const byCode = new Map(existing.map((e) => [e.channel, e]));
  const writes: ChannelWrite[] = [];
  const changes: string[] = [];
  for (const p of probed) {
    // A code with no `kind` is reported on screen but never written: `kind` keys the fee schedule.
    if (!p.kind) continue;
    const row = byCode.get(p.code);
    if (!row) {
      writes.push({ op: "insert", channel: p.code, label: p.label, kind: p.kind, active: p.active, enabled: false });
      changes.push(`${p.label} baru (${p.active ? "tersedia" : "tidak tersedia"} di provider, belum ditawarkan)`);
      continue;
    }
    const disable = !p.active && row.enabled;
    if (row.active === p.active && !disable) continue;
    writes.push({ op: "update", channel: p.code, set: disable ? { active: p.active, enabled: false } : { active: p.active } });
    if (row.active !== p.active) changes.push(`${row.label} ${p.active ? "tersedia" : "tidak tersedia"} di provider`);
    if (disable) changes.push(`${row.label} OFF (provider tidak menyediakan)`);
  }
  return { writes, changes };
}
