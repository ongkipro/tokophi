import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";

/**
 * STORE-USER INVITATIONS, DRIVEN AGAINST REAL POSTGRES (Task 5.3 / SEC-15).
 *
 * The claim under test is not "the action returns a nice object" — it is that **the row decides what
 * the seller is told**. Three of the four cases below are properties the type-checker cannot see and
 * a mock cannot produce:
 *
 *  - the uniqueness race is two transactions colliding on `users.email` and on
 *    `store_users (store_id, user_id)`, which only Postgres can arbitrate;
 *  - the "durable write failed after the credential existed" case is a rollback, and the thing being
 *    proved is the ABSENCE of a row plus the absence of a password in the reply;
 *  - "already accepted" is a column another surface writes, so it has to be read back, not assumed.
 *
 * ⚠️ There is NO MAILER in this repository — no nodemailer, no Resend, no SMTP anywhere (grepped).
 * The task's "database failure after mail success" therefore has no mail to succeed. Its real shape
 * here is the same defect one step earlier: `inviteStoreUser` MINTS a temporary password, and the
 * only copy that will ever exist is the string it returns. Reporting that string when the row
 * carrying its hash did not survive is exactly the `addStoreUser` incident in AGENTS.md — an operator
 * reading out a credential that verifies as FALSE. So `mintedCredentialSurvivesOrIsNotReported`
 * below injects a failure AFTER the mint and asserts the reply carries no password and the database
 * carries no account.
 *
 * Every assertion here was proved RED against the unfixed action first; the mutations and their
 * failure messages are recorded in BUILD-LOG.md.
 */

const h = vi.hoisted(() => ({
  db: null as unknown as PostgresJsDatabase,
  storeId: "",
  userId: "",
  revalidated: [] as string[],
  redirectedTo: null as string | null,
}));

// Only the two names the action module imports. Importing the real `@tokophi/db` would open a client
// against the DEV database at module scope.
vi.mock("@tokophi/db", async () => ({
  get db() {
    return h.db;
  },
  schema: await import("@tokophi/db/schema"),
}));

// `@/lib/auth` is deliberately NOT replaced: `hashPassword`, `verifyPassword`, `findLogin` and
// `signSession` are the very functions whose agreement is being proved — a minted password is
// checked by SIGNING IN with it, not by re-implementing scrypt in the test. Only the session reader
// is stubbed, because there is no cookie here.
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getSession: async () => ({
    userId: h.userId,
    storeId: h.storeId,
    role: "owner",
    email: "owner@example.test",
    name: "Owner",
  }),
}));

vi.mock("@/lib/rbac", () => ({
  requireCapability: async (capability: string) => {
    if (capability !== "settings:write") throw new Error(`unexpected capability: ${capability}`);
    return { storeId: h.storeId, userId: h.userId };
  },
}));

vi.mock("@/lib/tenant", () => ({
  withCurrentTenant: <T,>(fn: (db: PostgresJsDatabase, storeId: string) => Promise<T>) =>
    h.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.store_id', ${h.storeId}, true)`);
      await tx.execute(sql`set local role tokophi_app`);
      return fn(tx as unknown as PostgresJsDatabase, h.storeId);
    }),
}));

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    h.redirectedTo = to;
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.1` }),
  cookies: async () => ({ set: () => {}, get: () => undefined, delete: () => {} }),
}));

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;

let client: Sql;
let db: PostgresJsDatabase;
let inviteStoreUser: typeof import("./users").inviteStoreUser;
let getStoreUsers: typeof import("./users").getStoreUsers;
let signIn: typeof import("../actions/auth").signIn;

beforeAll(async () => {
  if (!URL_) return;
  process.env.AUTH_SECRET ??= "test-secret-for-store-user-invitations-0123456789";
  // `onnotice` is silenced only because the fault-injection test drops its trigger twice (`if exists`
  // in the `finally`), and two NOTICE blocks per run bury the assertions that matter.
  client = postgres(URL_, { max: 8, onnotice: () => {} });
  db = drizzle(client, { casing: "snake_case" });
  h.db = db;
  ({ inviteStoreUser, getStoreUsers } = await import("./users"));
  ({ signIn } = await import("../actions/auth"));
});

afterAll(async () => {
  if (client) await client.end();
});

beforeEach(() => {
  h.revalidated.length = 0;
  h.redirectedTo = null;
});

type Fixture = { accountId: string; storeId: string; ownerId: string; slug: string };

async function makeStore(label: string): Promise<Fixture> {
  const token = randomUUID();
  const slug = `invite-${token}`;
  const [account] = (await db.execute(
    sql`insert into accounts (name) values (${`Invite ${label}`}) returning id`,
  )) as unknown as { id: string }[];
  const [store] = (await db.execute(sql`
    insert into stores (account_id, name, slug)
    values (${account.id}, ${`Invite ${label}`}, ${slug}) returning id
  `)) as unknown as { id: string }[];
  const [owner] = (await db.execute(sql`
    insert into users (email, name, password_hash)
    values (${`owner-${token}@example.test`}, 'Owner', 'x:y') returning id
  `)) as unknown as { id: string }[];
  await db.execute(sql`
    insert into store_users (store_id, user_id, role, invited_at, accepted_at)
    values (${store.id}, ${owner.id}, 'owner', now(), now())
  `);
  return { accountId: account.id, storeId: store.id, ownerId: owner.id, slug };
}

async function dropStore(f: Fixture) {
  await db.execute(sql`delete from store_users where store_id = ${f.storeId}`);
  await db.execute(sql`delete from stores where id = ${f.storeId}`);
  await db.execute(sql`delete from accounts where id = ${f.accountId}`);
  await db.execute(sql`delete from users where id = ${f.ownerId}`);
}

async function dropUser(email: string) {
  await db.execute(sql`delete from store_users where user_id in (select id from users where email = ${email})`);
  await db.execute(sql`delete from users where email = ${email}`);
}

/**
 * Every membership row for this email, across every store — the durable truth.
 *
 * ⚠️ `db.execute` hands back the driver's RAW rows, so timestamps arrive as Postgres text
 * (`2026-08-22 12:45:23.908+00`), not as `Date`. Parse before comparing; never assume the shape.
 */
async function memberships(email: string) {
  return (await db.execute(sql`
    select su.store_id, su.role, su.invited_at, su.accepted_at
    from store_users su join users u on u.id = su.user_id
    where u.email = ${email}
    order by su.store_id
  `)) as unknown as { store_id: string; role: string; invited_at: string | null; accepted_at: string | null }[];
}

async function passwordHashOf(email: string): Promise<string | null> {
  const [row] = (await db.execute(
    sql`select password_hash from users where email = ${email}`,
  )) as unknown as { password_hash: string | null }[];
  return row?.password_hash ?? null;
}

/** The scrypt check `lib/auth.ts` performs — used only where signing in is not the point. */
function verifies(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(pw, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Drives the real sign-in server action. It ends in `redirect()`, which throws by design. */
async function attemptSignIn(email: string, password: string): Promise<string | null> {
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  try {
    const state = await signIn({}, form);
    return state?.error ?? "no-redirect";
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") return null;
    throw e;
  }
}

suite("inviteStoreUser (real PostgreSQL)", () => {
  it("creates the account once, and a retry reports the DURABLE row instead of a second membership", async () => {
    const f = await makeStore("retry");
    h.storeId = f.storeId;
    h.userId = f.ownerId;
    const email = `staf-${randomUUID()}@example.test`;

    try {
      const first = await inviteStoreUser({ name: "Sari Dewi", email, role: "staff" });
      expect(first).toMatchObject({ outcome: "created", email });
      if (first.outcome !== "created") throw new Error("expected a created account");
      // The credential is reported ONLY because the row carrying its hash exists.
      expect(verifies(first.password, await passwordHashOf(email))).toBe(true);

      const rows = await memberships(email);
      expect(rows).toHaveLength(1);
      expect(Number.isFinite(Date.parse(rows[0].invited_at ?? ""))).toBe(true);
      // 🔴 Acceptance is a fact about the INVITEE. Pressing "Undang" is not it.
      expect(rows[0].accepted_at).toBeNull();

      const hashBefore = await passwordHashOf(email);
      const retry = await inviteStoreUser({ name: "Sari Dewi", email, role: "admin" });
      expect(retry).toMatchObject({ outcome: "already_invited", email, role: "staff", password: null });
      // A retry must not reset a password, and must not change the role behind the seller's back.
      expect(await passwordHashOf(email)).toBe(hashBefore);
      expect(await memberships(email)).toHaveLength(1);
      // Nothing was written, so nothing is revalidated.
      expect(h.revalidated).toEqual(["/pengaturan"]);
    } finally {
      await dropUser(email);
      await dropStore(f);
    }
  });

  it("links an account that already exists elsewhere without minting or touching its password", async () => {
    const f = await makeStore("link");
    const other = await makeStore("link-other");
    h.storeId = other.storeId;
    h.userId = other.ownerId;
    const email = `pindah-${randomUUID()}@example.test`;

    try {
      h.storeId = f.storeId;
      h.userId = f.ownerId;
      const created = await inviteStoreUser({ name: "Budi", email, role: "staff" });
      if (created.outcome !== "created") throw new Error("expected a created account");
      const hashBefore = await passwordHashOf(email);

      h.storeId = other.storeId;
      h.userId = other.ownerId;
      const linked = await inviteStoreUser({ name: "Budi", email, role: "gudang" });
      expect(linked).toMatchObject({ outcome: "linked", email, password: null });
      // 🔴 The mirror of "never report a credential you did not write": their existing login stands.
      expect(await passwordHashOf(email)).toBe(hashBefore);
      expect(verifies(created.password, await passwordHashOf(email))).toBe(true);

      const rows = await memberships(email);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.accepted_at === null)).toBe(true);
      expect(new Set(rows.map((r) => r.role))).toEqual(new Set(["staff", "gudang"]));
    } finally {
      await dropUser(email);
      await dropStore(f);
      await dropStore(other);
    }
  });

  it("arbitrates two concurrent invitations of the same new address into one account and one membership", async () => {
    const f = await makeStore("race");
    h.storeId = f.storeId;
    h.userId = f.ownerId;
    const email = `barengan-${randomUUID()}@example.test`;
    const token = randomUUID().replaceAll("-", "");
    const fnName = `test_slow_membership_${token}`;

    try {
      // ⚠️ THE RACE IS FORCED, NOT HOPED FOR. Two bare `Promise.all` invitations collide only
      // sometimes — measured on the UNFIXED action, 19 of 20 pairs threw `users_email_unique` and
      // one slipped through cleanly — so a test that merely fires both is a coin toss, and a coin
      // toss is green for the wrong reason often enough to be trusted. Holding the FIRST
      // transaction open inside its `store_users` insert pins the interleave: caller B runs its
      // `select` while A's `users` row is written but uncommitted (therefore invisible), then
      // blocks on the unique index until A commits. B is guaranteed to meet BOTH conflicts.
      await client.unsafe(`
        create function "${fnName}"() returns trigger language plpgsql as $$
        begin
          if new.store_id = '${f.storeId}' then perform pg_sleep(0.3); end if;
          return new;
        end
        $$
      `);
      await client.unsafe(`
        create trigger "${fnName}" before insert on store_users
        for each row execute function "${fnName}"()
      `);

      const a = inviteStoreUser({ name: "Rina", email, role: "staff" });
      await new Promise((r) => setTimeout(r, 60));
      const b = inviteStoreUser({ name: "Rina", email, role: "staff" });
      const results = await Promise.all([a, b]);
      const outcomes = results.map((r) => r.outcome).sort();
      // Exactly one caller wrote the account; the loser must report the row, never a 500 and never a
      // password it did not write.
      expect(outcomes).toEqual(["already_invited", "created"]);
      const created = results.find((r) => r.outcome === "created");
      const loser = results.find((r) => r.outcome !== "created");
      if (created?.outcome !== "created") throw new Error("expected exactly one created result");
      expect(loser?.password).toBeNull();
      expect(verifies(created.password, await passwordHashOf(email))).toBe(true);

      const accounts = (await db.execute(
        sql`select count(*)::int as n from users where email = ${email}`,
      )) as unknown as { n: number }[];
      expect(accounts[0].n).toBe(1);
      expect(await memberships(email)).toHaveLength(1);
    } finally {
      await client.unsafe(`drop trigger if exists "${fnName}" on store_users`).catch(() => {});
      await client.unsafe(`drop function if exists "${fnName}"()`).catch(() => {});
      await dropUser(email);
      await dropStore(f);
    }
  });

  it("never reports the password of an account it lost the race to create", async () => {
    // 🔴 THE `addStoreUser` INCIDENT, IN ITS ONLY REACHABLE SHAPE HERE. Two stores invite the same
    // brand-new address at the same instant. Both mint a temporary password; exactly one `users` row
    // can exist, so one of those strings is hashed into it and the OTHER is hashed into nothing. The
    // loser still writes a perfectly good MEMBERSHIP, so it returns a success — and if `password`
    // were assigned before the insert was known to have won, that success would carry a well-formed
    // `tokophi-…` that verifies as FALSE. The seller reads it out, it does not work, and no screen
    // can say why. The single-store race cannot expose this: its loser is `already_invited`, whose
    // reply is a literal `null` either way.
    const one = await makeStore("cross-a");
    const two = await makeStore("cross-b");
    const email = `rebutan-${randomUUID()}@example.test`;
    const token = randomUUID().replaceAll("-", "");
    const fnName = `test_slow_cross_${token}`;

    try {
      await client.unsafe(`
        create function "${fnName}"() returns trigger language plpgsql as $$
        begin
          if new.store_id in ('${one.storeId}', '${two.storeId}') then perform pg_sleep(0.3); end if;
          return new;
        end
        $$
      `);
      await client.unsafe(`
        create trigger "${fnName}" before insert on store_users
        for each row execute function "${fnName}"()
      `);

      h.storeId = one.storeId;
      h.userId = one.ownerId;
      const a = inviteStoreUser({ name: "Tari", email, role: "staff" });
      await new Promise((r) => setTimeout(r, 60));
      h.storeId = two.storeId;
      h.userId = two.ownerId;
      const b = inviteStoreUser({ name: "Tari", email, role: "admin" });
      const [first, second] = await Promise.all([a, b]);

      expect(first.outcome).toBe("created");
      expect(second.outcome).toBe("linked");
      if (first.outcome !== "created") throw new Error("expected the first caller to create");
      const stored = await passwordHashOf(email);
      expect(verifies(first.password, stored)).toBe(true);
      expect(second.password).toBeNull();

      const accounts = (await db.execute(
        sql`select count(*)::int as n from users where email = ${email}`,
      )) as unknown as { n: number }[];
      expect(accounts[0].n).toBe(1);
      expect(await memberships(email)).toHaveLength(2);
    } finally {
      await client.unsafe(`drop trigger if exists "${fnName}" on store_users`).catch(() => {});
      await client.unsafe(`drop function if exists "${fnName}"()`).catch(() => {});
      await dropUser(email);
      await dropStore(one);
      await dropStore(two);
    }
  });

  it("reports failure — with no credential and no account — when the durable write fails after the mint", async () => {
    const f = await makeStore("rollback");
    h.storeId = f.storeId;
    h.userId = f.ownerId;
    const email = `gagal-${randomUUID()}@example.test`;
    const token = randomUUID().replaceAll("-", "");
    const fnName = `test_fail_membership_${token}`;

    try {
      await client.unsafe(`
        create function "${fnName}"() returns trigger language plpgsql as $$
        begin
          if new.store_id = '${f.storeId}' then
            raise exception 'injected membership failure';
          end if;
          return new;
        end
        $$
      `);
      await client.unsafe(`
        create trigger "${fnName}" before insert on store_users
        for each row execute function "${fnName}"()
      `);

      const failed = await inviteStoreUser({ name: "Wahyu", email, role: "staff" });
      expect(failed.outcome).toBe("failed");
      // 🔴 The whole point: a password was MINTED before the write failed. It must not be reported,
      // and the account whose hash it would have been must not exist.
      expect(failed.password).toBeNull();
      expect(await passwordHashOf(email)).toBeNull();
      expect(await memberships(email)).toEqual([]);
      expect(h.revalidated).toEqual([]);

      await client.unsafe(`drop trigger "${fnName}" on store_users`);
      await client.unsafe(`drop function "${fnName}"()`);

      // Retriable: the same request, once the fault is gone, converges on one good account.
      const retry = await inviteStoreUser({ name: "Wahyu", email, role: "staff" });
      expect(retry.outcome).toBe("created");
      if (retry.outcome !== "created") throw new Error("expected a created account");
      expect(verifies(retry.password, await passwordHashOf(email))).toBe(true);
      expect(await memberships(email)).toHaveLength(1);
    } finally {
      await client.unsafe(`drop trigger if exists "${fnName}" on store_users`).catch(() => {});
      await client.unsafe(`drop function if exists "${fnName}"()`).catch(() => {});
      await dropUser(email);
      await dropStore(f);
    }
  });

  it("turns invited into accepted only when the invitee signs in, and says so on a re-invite", async () => {
    const f = await makeStore("accept");
    h.storeId = f.storeId;
    h.userId = f.ownerId;
    const email = `terima-${randomUUID()}@example.test`;

    try {
      const created = await inviteStoreUser({ name: "Dian", email, role: "staff" });
      if (created.outcome !== "created") throw new Error("expected a created account");
      expect((await getStoreUsers()).find((u) => u.email === email)?.acceptedAt).toBeNull();

      // A WRONG password must not accept the invitation.
      expect(await attemptSignIn(email, "tokophi-salahsemua")).toBe("Email atau kata sandi salah.");
      expect((await memberships(email))[0].accepted_at).toBeNull();

      // The credential the seller was handed is the one that opens the account.
      expect(await attemptSignIn(email, created.password)).toBeNull();
      expect(h.redirectedTo).toBe(`/store/${f.slug}`);
      const accepted = (await memberships(email))[0].accepted_at;
      expect(Number.isFinite(Date.parse(accepted ?? ""))).toBe(true);

      const again = await inviteStoreUser({ name: "Dian", email, role: "staff" });
      expect(again).toMatchObject({ outcome: "already_accepted", email, role: "staff", password: null });
      expect(await memberships(email)).toHaveLength(1);

      // Signing in a second time must not move the stamp — acceptance happened once.
      await attemptSignIn(email, created.password);
      expect((await memberships(email))[0].accepted_at).toEqual(accepted);
      expect((await getStoreUsers()).find((u) => u.email === email)?.acceptedAt).toBe(
        new Date(accepted ?? "").toISOString(),
      );
    } finally {
      await dropUser(email);
      await dropStore(f);
    }
  });

  it("refuses invalid input before it reaches the database", async () => {
    const f = await makeStore("validate");
    h.storeId = f.storeId;
    h.userId = f.ownerId;
    try {
      for (const bad of [
        { name: "  ", email: "a@example.test", role: "staff" as const },
        { name: "Ana", email: "   ", role: "staff" as const },
        { name: "Ana", email: "a@example.test", role: "owner" as never },
      ]) {
        const r = await inviteStoreUser(bad);
        expect(r.outcome).toBe("failed");
        expect(r.password).toBeNull();
      }
      expect(h.revalidated).toEqual([]);
    } finally {
      await dropStore(f);
    }
  });
});
