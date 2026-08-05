import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { sessionOutlivesPassword } from "./session-revocation";

// A password change must END the sessions the old password opened.
//
// Before migration 0087 it did not: logged in as a store owner, `users.password_hash` was rewritten
// and the browser stayed authenticated on `/produk` for the token's full 7 days. Both incident-
// response levers — the merchant's own `/akun/keamanan` change and super-admin's "Reset password
// owner" — were therefore decorative, and the only working kill switch was deleting the owner from
// their own shop.
//
// The claim has TWO halves and both are pinned here, because either one alone is a broken control:
//   1. a token issued BEFORE the rotation is refused  (the defect)
//   2. a token issued AFTER it is accepted            (the regression that would lock everyone out)
//
// The second suite asks the DATABASE, because the guarantee is a database guarantee. Six code paths
// write `users.password_hash`; the stamp is a BEFORE UPDATE trigger precisely so none of them can
// forget it, and that is a claim about DDL that no unit test over TypeScript can make. It is also the
// claim that covers the writer this finding was actually driven with — a bare `psql` UPDATE.

const AT = new Date("2026-08-03T10:00:00.500Z"); // .500 — deliberately mid-second
const sec = Math.floor(AT.getTime() / 1000);

describe("sessionOutlivesPassword", () => {
  it("refuses a token minted before the rotation — THE DEFECT", () => {
    expect(sessionOutlivesPassword(sec - 1, AT)).toBe(false);
    expect(sessionOutlivesPassword(sec - 86_400, AT)).toBe(false);
  });

  it("accepts a token minted after the rotation — a fresh login must WORK", () => {
    expect(sessionOutlivesPassword(sec + 1, AT)).toBe(true);
  });

  it("resolves the SAME SECOND to revoked", () => {
    // `iat` is whole seconds, `password_changed_at` is microseconds: a token stamped `sec` may have
    // been signed 400 ms either side of this rotation and cannot say which. The two errors are not
    // the same size — a false survival is the defect itself; a false revocation costs one login.
    expect(sessionOutlivesPassword(sec, AT)).toBe(false);
  });

  it("lets every session that predates the column stand — the deploy signs NOBODY out", () => {
    // If this ever flips, shipping it logs out every merchant currently holding a cookie.
    expect(sessionOutlivesPassword(sec, null)).toBe(true);
    expect(sessionOutlivesPassword(undefined, null)).toBe(true);
  });

  it("refuses a token with no `iat` when the password HAS been rotated", () => {
    // Every token this app mints carries `iat`. One that does not cannot prove it is newer, and a
    // security control that cannot prove it must fail closed.
    expect(sessionOutlivesPassword(undefined, AT)).toBe(false);
    expect(sessionOutlivesPassword(Number.NaN, AT)).toBe(false);
  });
});

// ── The DDL half. Same throwaway `*_test` database the ledger suites use (test/db-setup.ts), never
// the shared dev one; every statement rolls back.
const URL = process.env.TEST_DATABASE_URL;
const dbSuite = URL ? describe : describe.skip;

dbSuite("users.password_changed_at is stamped by the DATABASE, not by callers", () => {
  let sqlc: ReturnType<typeof postgres>;
  beforeAll(() => {
    sqlc = postgres(URL!, { max: 1 });
  });
  afterAll(async () => {
    await sqlc?.end();
  });

  /** Seed one user, run `mutate` against it, return the resulting row. Always rolled back. */
  async function withUser(mutate: (tx: postgres.TransactionSql, id: string) => Promise<void>) {
    let out: { password_hash: string | null; password_changed_at: Date | null } | undefined;
    const ROLLBACK = Symbol("rollback");
    try {
      await sqlc.begin(async (tx) => {
        const [u] = await tx<{ id: string; password_changed_at: Date | null }[]>`
          insert into users (email, name, password_hash)
          values (${`revocation-${Date.now()}@test.invalid`}, 'Test', 'salt:aaaa')
          returning id, password_changed_at`;
        // Half of the design, asserted where it is decided: INSERT does NOT stamp. There is no prior
        // credential and no prior session to revoke — and a stamp here would sign every freshly
        // created account out of the very request that created it (signup/invite mint a session in
        // the same second they write the hash, and same-second resolves to revoked).
        expect(u.password_changed_at, "an INSERT must not stamp").toBeNull();
        await mutate(tx, u.id);
        [out] = await tx`select password_hash, password_changed_at from users where id = ${u.id}`;
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
    return out!;
  }

  it("a RAW psql-style UPDATE stamps it — the writer this finding was driven with", async () => {
    // No application code in this path at all. This is the assertion a column set by callers could
    // not make, and the one that makes `getSession()` refuse the cookie afterwards.
    const row = await withUser(async (tx, id) => {
      await tx`update users set password_hash = 'salt:bbbb' where id = ${id}`;
    });
    expect(row.password_hash).toBe("salt:bbbb");
    expect(row.password_changed_at).toBeInstanceOf(Date);
  });

  it("an UPDATE that does not touch the password leaves it alone", () => {
    // Otherwise enabling 2FA, or any unrelated write to `users`, would silently end every session.
    return withUser(async (tx, id) => {
      await tx`update users set name = 'Renamed' where id = ${id}`;
    }).then((row) => {
      expect(row.password_changed_at).toBeNull();
    });
  });

  it("re-writing the SAME hash does not stamp", async () => {
    const row = await withUser(async (tx, id) => {
      await tx`update users set password_hash = 'salt:aaaa' where id = ${id}`;
    });
    expect(row.password_changed_at).toBeNull();
  });
});

// ── The CONTROL PLANE half (migration 0088). Same guarantee, same trigger FUNCTION, second table.
//
// `platform_admins` had no revocation of any kind — and no way to change a password at all, so the
// question never came up until one had to be rotated. The trigger is deliberately 0087's function
// re-used rather than a second copy: this repo has twice paid for a duplicated security rule (two
// password mints, one of them 24 bits, on the weaker path). What that re-use makes worth asserting
// is that the function really was ATTACHED here — a trigger nobody created is a column that stays
// NULL forever, which reads exactly like "never rotated" and silently revokes nothing.
dbSuite("platform_admins.password_changed_at is stamped by the same DATABASE trigger", () => {
  let sqlc: ReturnType<typeof postgres>;
  beforeAll(() => {
    sqlc = postgres(URL!, { max: 1 });
  });
  afterAll(async () => {
    await sqlc?.end();
  });

  async function withOperator(mutate: (tx: postgres.TransactionSql, id: string) => Promise<void>) {
    let out: { password_hash: string | null; password_changed_at: Date | null } | undefined;
    const ROLLBACK = Symbol("rollback");
    try {
      await sqlc.begin(async (tx) => {
        const [a] = await tx<{ id: string; password_changed_at: Date | null }[]>`
          insert into platform_admins (email, name, role, password_hash)
          values (${`revocation-${Date.now()}@test.invalid`}, 'Test', 'support', 'salt:aaaa')
          returning id, password_changed_at`;
        expect(a.password_changed_at, "an INSERT must not stamp").toBeNull();
        await mutate(tx, a.id);
        [out] = await tx`select password_hash, password_changed_at from platform_admins where id = ${a.id}`;
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
    return out!;
  }

  it("rotating an operator's password stamps it", async () => {
    const row = await withOperator(async (tx, id) => {
      await tx`update platform_admins set password_hash = 'salt:bbbb' where id = ${id}`;
    });
    expect(row.password_hash).toBe("salt:bbbb");
    expect(row.password_changed_at).toBeInstanceOf(Date);
  });

  it("changing an operator's ROLE does not stamp", async () => {
    // A demotion must not also sign the operator out — the re-read already handles rank on the next
    // request, and conflating the two would make every role edit an unexplained logout.
    const row = await withOperator(async (tx, id) => {
      await tx`update platform_admins set role = 'admin' where id = ${id}`;
    });
    expect(row.password_changed_at).toBeNull();
  });
});
