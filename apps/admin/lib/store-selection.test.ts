import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { codeOnly, textWithoutComments } from "../../../test/source-code";

/**
 * STORE SELECTION IS A CONTRACT, DRIVEN AGAINST REAL POSTGRES (Task 5.9 / F-T10).
 *
 * The measured defect (2026-08-23): a user with two memberships landed on an ARBITRARY store at
 * login — the membership join had no ORDER BY, so the winner was plan-dependent — and the topbar
 * switcher never offered the second store. "Which store am I in?" is the input to every RLS GUC and
 * every capability check, so the answer must be the same on every plan, every replica, every deploy.
 *
 * The contract under test (owned by `store-selection.ts`): earliest `invited_at` first (nulls
 * last), tie-broken by ascending store id. Plus the two boundaries around it: `resolveMembership`
 * answers "may this user switch to that store?" from `store_users` NOW (revocation = row gone =
 * null), and `findLoginRow` is a LEFT join so an account with no membership resolves with
 * `storeId: null` — a clear refusal in `signIn`, not a fake "wrong password".
 */

const h = vi.hoisted(() => ({ db: null as unknown as PostgresJsDatabase }));

// Only the two names the module imports. `db` is bound to the throwaway test database in beforeAll;
// importing the real `@tokophi/db` would open a client against the DEV database at module scope.
vi.mock("@tokophi/db", async () => ({
  get db() {
    return h.db;
  },
  schema: await import("@tokophi/db/schema"),
}));

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: Sql;
let db: PostgresJsDatabase;
let listMemberships: typeof import("./store-selection").listMemberships;
let resolveMembership: typeof import("./store-selection").resolveMembership;
let findLoginRow: typeof import("./store-selection").findLoginRow;

type Fixture = { userId: string; email: string; storeA: string; storeB: string; slugA: string; slugB: string };

/**
 * One user, two stores. `invitedAt` is set EXPLICITLY per membership by each test — the ordering is
 * the thing under test, so no default may sneak in.
 */
async function makeFixture(invitedA: string | null, invitedB: string | null): Promise<Fixture> {
  const token = randomUUID();
  const email = `dua-toko-${token}@example.test`;
  const [account] = (await db.execute(sql`
    insert into accounts (name) values (${`Selection ${token}`}) returning id
  `)) as unknown as { id: string }[];
  const mkStore = async (label: string) => {
    const [s] = (await db.execute(sql`
      insert into stores (account_id, name, slug) values (${account.id}, ${label}, ${`sel-${label}-${token}`}) returning id
    `)) as unknown as { id: string }[];
    return s.id;
  };
  const storeA = await mkStore("a");
  const storeB = await mkStore("b");
  const [user] = (await db.execute(sql`
    insert into users (email, name, password_hash) values (${email}, 'Dua Toko', 'salt:deadbeef') returning id
  `)) as unknown as { id: string }[];
  await db.execute(sql`
    insert into store_users (store_id, user_id, role, invited_at)
    values (${storeA}, ${user.id}, 'owner', ${invitedA}),
           (${storeB}, ${user.id}, 'staff', ${invitedB})
  `);
  return { userId: user.id, email, storeA, storeB, slugA: `sel-a-${token}`, slugB: `sel-b-${token}` };
}

beforeAll(async () => {
  if (!URL) return;
  client = postgres(URL, { max: 8 });
  db = drizzle(client, { casing: "snake_case" });
  h.db = db;
  // Dynamic, so the mock above is in place before the module loads.
  ({ listMemberships, resolveMembership, findLoginRow } = await import("./store-selection"));
});

afterAll(async () => {
  if (client) await client.end();
});

suite("the default store is deterministic — earliest invited_at, then store id", () => {
  it("two memberships: the EARLIER invitation wins, in findLoginRow and listMemberships alike", async () => {
    // B was invited a day before A — B must win regardless of insert order or plan.
    const f = await makeFixture("2026-08-02T00:00:00Z", "2026-08-01T00:00:00Z");
    const row = await findLoginRow(f.email);
    expect(row?.storeId).toBe(f.storeB);
    expect(row?.role).toBe("staff");
    expect(row?.slug).toBe(f.slugB);
    const list = await listMemberships(f.userId);
    expect(list.map((m) => m.storeId)).toEqual([f.storeB, f.storeA]);
  });

  it("identical invited_at: the tie-break is ascending store id — one answer, not a coin toss", async () => {
    const t = "2026-08-01T00:00:00Z";
    const f = await makeFixture(t, t);
    const expected = [f.storeA, f.storeB].sort();
    const row = await findLoginRow(f.email);
    expect(row?.storeId).toBe(expected[0]);
    const list = await listMemberships(f.userId);
    expect(list.map((m) => m.storeId)).toEqual(expected);
  });

  it("a NULL invited_at sorts LAST — an undated membership never outranks a dated invitation", async () => {
    const f = await makeFixture(null, "2026-08-01T00:00:00Z");
    const row = await findLoginRow(f.email);
    expect(row?.storeId).toBe(f.storeB);
  });
});

suite("switching is a membership check against store_users, now", () => {
  it("a member of the target store resolves — with the role read from the row, not the session", async () => {
    const f = await makeFixture("2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z");
    const m = await resolveMembership(f.userId, f.storeB);
    expect(m?.storeId).toBe(f.storeB);
    expect(m?.role).toBe("staff");
    expect(m?.slug).toBe(f.slugB);
  });

  it("a NON-member store resolves to null — the switch action must refuse", async () => {
    const f = await makeFixture("2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z");
    const [stranger] = (await db.execute(sql`
      select id from stores where id not in (${f.storeA}, ${f.storeB}) limit 1
    `)) as unknown as { id: string }[];
    // The test DB always has at least the fixture stores of other tests; if truly none, make one.
    let strangerId = stranger?.id;
    if (!strangerId) {
      const [acc] = (await db.execute(sql`insert into accounts (name) values ('Stranger') returning id`)) as unknown as { id: string }[];
      const [s] = (await db.execute(sql`
        insert into stores (account_id, name, slug) values (${acc.id}, 'Stranger', ${`stranger-${randomUUID()}`}) returning id
      `)) as unknown as { id: string }[];
      strangerId = s.id;
    }
    expect(await resolveMembership(f.userId, strangerId)).toBeNull();
  });

  it("REVOCATION: deleting the membership row kills the choice at once — and login falls back to the OTHER store", async () => {
    const f = await makeFixture("2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z");
    // A is the default (earlier invitation). Revoke it.
    expect((await findLoginRow(f.email))?.storeId).toBe(f.storeA);
    await db.execute(sql`delete from store_users where user_id = ${f.userId} and store_id = ${f.storeA}`);
    // The old choice is dead — `getSession`'s membership re-read and `switchStore`'s check both
    // run through this shape and both must see nothing.
    expect(await resolveMembership(f.userId, f.storeA)).toBeNull();
    // The deterministic default is now the surviving membership, not a 500 and not the ghost of A.
    expect((await findLoginRow(f.email))?.storeId).toBe(f.storeB);
    expect((await listMemberships(f.userId)).map((m) => m.storeId)).toEqual([f.storeB]);
  });

  it("NO membership at all: the account still resolves, with storeId null — a clear refusal, not 'wrong password'", async () => {
    const f = await makeFixture("2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z");
    await db.execute(sql`delete from store_users where user_id = ${f.userId}`);
    const row = await findLoginRow(f.email);
    // The LEFT join is the point: the user row (and its password hash) still comes back, so signIn
    // can verify the password and then name the REAL reason.
    expect(row).not.toBeNull();
    expect(row?.passwordHash).toBe("salt:deadbeef");
    expect(row?.storeId).toBeNull();
    expect(row?.role).toBeNull();
  });
});

/**
 * SOURCE CLAIMS — the wiring that cannot be driven here because it reads cookies()/next-headers.
 * Each claim carries a mutation self-check where the shape allows, so it cannot be green for want
 * of matching anything (the repo's standing rule for source-reading guards).
 */
describe("the switch action and signIn keep the boundary (source claims)", () => {
  const actionSrc = codeOnly(readFileSync(join(__dirname, "actions/store.ts"), "utf8"));
  const signInSrc = codeOnly(readFileSync(join(__dirname, "actions/auth.ts"), "utf8"));
  const authSrc = codeOnly(readFileSync(join(__dirname, "auth.ts"), "utf8"));

  it("switchStore proves membership via resolveMembership BEFORE minting, and refuses null", () => {
    const resolveAt = actionSrc.search(/resolveMembership\s*\(\s*session\s*\.\s*userId\s*,\s*storeId\s*\)/);
    const refuseAt = actionSrc.search(/if\s*\(\s*!\s*membership\s*\)\s*return/);
    const mintAt = actionSrc.search(/signSession\s*\(/);
    expect(resolveAt).toBeGreaterThan(-1);
    expect(refuseAt).toBeGreaterThan(resolveAt);
    expect(mintAt).toBeGreaterThan(refuseAt);
    // Mutation self-check: the same predicates fire on a copy with the check removed/reordered.
    const mutated = actionSrc.replace(/if\s*\(\s*!\s*membership\s*\)\s*return[^;]*;/, "");
    expect(mutated.search(/if\s*\(\s*!\s*membership\s*\)\s*return/)).toBe(-1);
  });

  it("switchStore refuses an impersonated session — the grant was for ONE store", () => {
    expect(actionSrc).toMatch(/session\s*\.\s*imp/);
  });

  it("signIn refuses a password-valid account with no membership, with its own message", () => {
    const guardAt = signInSrc.search(/!\s*row\s*\.\s*storeId\s*\|\|\s*!\s*row\s*\.\s*role/);
    const mintAt = signInSrc.search(/signSession\s*\(/);
    expect(guardAt).toBeGreaterThan(-1);
    expect(mintAt).toBeGreaterThan(guardAt);
    // `textWithoutComments`, deliberately: the claim is about the MESSAGE a merchant reads, which
    // lives inside a string literal — `codeOnly` would inert it and this could never match.
    const signInText = textWithoutComments(readFileSync(join(__dirname, "actions/auth.ts"), "utf8"));
    expect(signInText).toMatch(/tidak\s+punya\s+akses\s+ke\s+toko/);
  });

  it("auth.ts's findLogin IS the contract module's query — no second, unordered copy", () => {
    // The old defect was an inner join with `.limit(1)` and no orderBy living here. The re-export
    // is the fix: auth.ts must not carry its own membership-selection query for login.
    expect(authSrc).toMatch(/findLoginRow\s+as\s+findLogin/);
    expect(authSrc.search(/innerJoin\s*\(\s*schema\s*\.\s*storeUsers[\s\S]*?limit\s*\(\s*1\s*\)/)).toBe(-1);
    // Mutation self-check: the predicate DOES fire on the old shape.
    const oldShape = codeOnly(
      "const [row] = await db.select({}).from(schema.users).innerJoin(schema.storeUsers, eq(a,b)).limit(1);",
    );
    expect(oldShape.search(/innerJoin\s*\(\s*schema\s*\.\s*storeUsers[\s\S]*?limit\s*\(\s*1\s*\)/)).toBeGreaterThan(-1);
  });
});
