import type { Sql } from "postgres";

/**
 * `platform_finance` is ONE row (id = 1) — the global subscription-PPN toggle — and every DB suite runs
 * against the same `_test` database, in parallel. A suite that flips the toggle (ADR 0020's PPN-on
 * pricing test) would otherwise change what another suite's invoice creator bills mid-assertion (the
 * cron renewal test pins `tax_idr = 0`). Each suite that READS OR WRITES the toggle holds this
 * session-level advisory lock for its whole run, on a RESERVED connection (a pooled query could land the
 * unlock on a connection that never took the lock), and puts the value back before releasing it.
 */
const KEY = 2_026_111_301; // arbitrary, fixed: the same number in every holder

export async function holdPlatformFinance(client: Sql): Promise<{ setPpn: (on: boolean) => Promise<void>; release: () => Promise<void> }> {
  const conn = await client.reserve();
  await conn`select pg_advisory_lock(${KEY})`;
  const [before] = await conn<{ on: boolean }[]>`select subscription_ppn_enabled as on from platform_finance where id = 1`;
  const setPpn = async (on: boolean) => {
    await conn`insert into platform_finance (id, subscription_ppn_enabled) values (1, ${on})
               on conflict (id) do update set subscription_ppn_enabled = ${on}`;
  };
  return {
    setPpn,
    release: async () => {
      try {
        if (before) await setPpn(before.on);
      } finally {
        await conn`select pg_advisory_unlock(${KEY})`;
        conn.release();
      }
    },
  };
}
