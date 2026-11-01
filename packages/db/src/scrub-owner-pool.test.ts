import { describe, expect, it } from "vitest";
import { inspect } from "node:util";

// The independent review (2026-11-02) found that scrubbing only inside `withTenant` left the OWNER pool
// — public order route, cron, storefront — logging every bound value. This drives a real failing
// query through BOTH handles and asserts neither the message nor the printed error carries the value.
//
// SCOPE LIMIT, measured: Postgres itself sometimes echoes a value in ITS message (`invalid input syntax
// for type integer: "…"`) and in `detail` (`Key (email)=(…)`). `detail` is blanked by the scrub; the
// echo in a type-error message is the driver's own text, identical before drizzle 0.45, and is the
// diagnostic — so this test uses a failure that does not echo (`relation … does not exist`).
const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;

suite("query errors never carry bound values (real Postgres)", () => {
  it("owner `db` and `withTenant` both", async () => {
    process.env.DATABASE_URL = URL_!;
    const { db, withTenant } = await import("./index");
    const { sql } = await import("drizzle-orm");
    const { pgError } = await import("@tokophi/lib/pg-errors");
    const secret = "SECRETVALUE-owner-pool";
    for (const run of [
      () => db.execute(sql`select 1 from tokophi_no_such_table_xyz where a = ${secret}`),
      () => withTenant("00000000-0000-0000-0000-000000000000", (tx) => tx.execute(sql`select 1 from tokophi_no_such_table_xyz where a = ${secret}`)),
    ]) {
      let err: unknown;
      try {
        await run();
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(String((err as Error).message)).not.toContain(secret);
      expect(inspect(err, { depth: 6 })).not.toContain(secret);
      expect(pgError(err)?.code).toBe("42P01"); // the diagnostic survives
    }
  });
});
