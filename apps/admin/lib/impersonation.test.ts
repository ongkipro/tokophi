import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { decodeJwt } from "jose";
import { codeOnly } from "../../../test/source-code";
import {
  IMPERSONATION_SESSION_EXPIRY,
  IMPERSONATION_SESSION_MAX_AGE,
  grantTokenHash,
  mintGrantToken,
} from "@tokophi/lib/impersonation";
import type { ExchangeResult } from "./impersonation";
import type { Session } from "./auth";

/**
 * THE IMPERSONATION EXCHANGE, DRIVEN AGAINST REAL POSTGRES (Task 4.11 / SEC-10).
 *
 * The claim under test is not "the code looks right" — it is that ONE handle opens ONE session and
 * that every other path fails CLOSED. Three of the four failure modes are properties of a single
 * SQL statement (`update … where token_hash = $1 and consumed_at is null and expires_at > now()`),
 * and none of them can be observed without a database: replay is a row lock and a re-evaluated
 * predicate, expiry is Postgres's own clock, and the concurrency case is two transactions racing.
 *
 * Every assertion here was proved RED first, by mutating `impersonation.ts` — the results are
 * recorded in BUILD-LOG. A guard nobody has seen fail is green for reasons nobody has checked.
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
let consumeImpersonationGrant: (token: string | null | undefined) => Promise<ExchangeResult>;
let signSession: (s: Session, issuedAt?: Date, expiresIn?: string) => Promise<string>;

type Fixture = {
  accountId: string;
  storeId: string;
  slug: string;
  userId: string;
  email: string;
  operatorId: string;
  operatorEmail: string;
};

/** A store with an owner, plus the platform operator who will impersonate them. */
async function makeFixture(): Promise<Fixture> {
  const token = randomUUID();
  const slug = `imp-${token}`;
  const email = `owner-${token}@example.test`;
  const operatorEmail = `operator-${token}@example.test`;
  const [account] = (await db.execute(sql`
    insert into accounts (name) values (${`Impersonate ${token}`}) returning id
  `)) as unknown as { id: string }[];
  const [store] = (await db.execute(sql`
    insert into stores (account_id, name, slug) values (${account.id}, 'Impersonate', ${slug}) returning id
  `)) as unknown as { id: string }[];
  const [user] = (await db.execute(sql`
    insert into users (email, name) values (${email}, 'Pemilik Toko') returning id
  `)) as unknown as { id: string }[];
  await db.execute(sql`
    insert into store_users (store_id, user_id, role) values (${store.id}, ${user.id}, 'owner')
  `);
  const [operator] = (await db.execute(sql`
    insert into platform_admins (email, name, role, password_hash)
    values (${operatorEmail}, 'Operator', 'owner', 'salt:deadbeef') returning id
  `)) as unknown as { id: string }[];
  return {
    accountId: account.id,
    storeId: store.id,
    slug,
    userId: user.id,
    email,
    operatorId: operator.id,
    operatorEmail,
  };
}

/**
 * Mint a grant the way `impersonateStore` does. Deliberately NOT a call into the super-admin action
 * (that would drag `next/headers` and the platform cookie in): what matters is that the row is
 * shaped identically and the digest comes from the SAME shared helper both apps use.
 */
async function mintGrant(
  f: Fixture,
  opts?: { expiresInSeconds?: number; createdSecondsAgo?: number; operatorRole?: string },
): Promise<string> {
  const token = mintGrantToken();
  const ttl = opts?.expiresInSeconds ?? 120;
  const age = opts?.createdSecondsAgo ?? 0;
  await db.execute(sql`
    insert into impersonation_grants
      (token_hash, store_id, user_id, operator_id, operator_email, operator_role, expires_at, created_at)
    values (
      ${grantTokenHash(token)}, ${f.storeId}, ${f.userId}, ${f.operatorId}, ${f.operatorEmail},
      ${opts?.operatorRole ?? "owner"},
      now() + make_interval(secs => ${ttl}),
      now() - make_interval(secs => ${age})
    )
  `);
  return token;
}

async function grantRow(token: string): Promise<{ consumed_at: Date | null }> {
  const [row] = (await db.execute(sql`
    select consumed_at from impersonation_grants where token_hash = ${grantTokenHash(token)}
  `)) as unknown as { consumed_at: Date | null }[];
  return row;
}

beforeAll(async () => {
  if (!URL) return;
  client = postgres(URL, { max: 8 });
  db = drizzle(client, { casing: "snake_case" });
  h.db = db;
  // Dynamic, so the mock above is in place before the module (and `@/lib/auth` behind it) loads.
  ({ consumeImpersonationGrant } = await import("./impersonation"));
  ({ signSession } = await import("./auth"));
});

afterAll(async () => {
  if (client) await client.end();
});

suite("one handle, one session — and every other path fails closed", () => {
  it("SUCCESS: a fresh handle is spent exactly once and yields the merchant's session", async () => {
    const f = await makeFixture();
    const token = await mintGrant(f);

    const result = await consumeImpersonationGrant(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.slug).toBe(f.slug);
    expect(result.session.storeId).toBe(f.storeId);
    expect(result.session.userId).toBe(f.userId);
    expect(result.session.email).toBe(f.email);
    // Role comes from `store_users`, never from the handle — the handle carries no claims at all.
    expect(result.session.role).toBe("owner");
    // BOTH identities travel in the session: the merchant above, the operator here.
    expect(result.session.imp?.operatorId).toBe(f.operatorId);
    expect(result.session.imp?.operatorEmail).toBe(f.operatorEmail);

    // The row is now spent. This is the fact that makes the next test impossible to pass by luck.
    expect((await grantRow(token)).consumed_at).not.toBeNull();
  });

  it("REPLAY: the same handle a second time is refused, and refused as SPENT", async () => {
    const f = await makeFixture();
    const token = await mintGrant(f);

    expect((await consumeImpersonationGrant(token)).ok).toBe(true);
    const second = await consumeImpersonationGrant(token);
    expect(second).toEqual({ ok: false, reason: "spent" });
  });

  it("REPLAY under CONCURRENCY: two simultaneous redemptions, exactly one wins", async () => {
    const f = await makeFixture();
    const token = await mintGrant(f);

    // The case a read-then-write implementation passes every sequential test and still loses: both
    // callers see `consumed_at is null` before either writes. The row lock is what decides it.
    const [a, b] = await Promise.all([
      consumeImpersonationGrant(token),
      consumeImpersonationGrant(token),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.ok).toBe(false);
    if (!loser.ok) expect(loser.reason).toBe("spent");
  });

  it("TAMPER: one changed character is refused as UNKNOWN — and does not burn the real handle", async () => {
    const f = await makeFixture();
    const token = await mintGrant(f);
    const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);

    expect(await consumeImpersonationGrant(tampered)).toEqual({ ok: false, reason: "unknown" });
    // ⚠️ The genuine handle must still work. A near-miss that consumed the row would be a denial of
    // service anyone could trigger by mangling a URL they saw in a log.
    expect((await grantRow(token)).consumed_at).toBeNull();
    expect((await consumeImpersonationGrant(token)).ok).toBe(true);
  });

  it("EXPIRY: a handle past its window is refused, and is NOT marked consumed by the attempt", async () => {
    const f = await makeFixture();
    const token = await mintGrant(f, { expiresInSeconds: -1 });

    expect(await consumeImpersonationGrant(token)).toEqual({ ok: false, reason: "expired" });
    // Postgres evaluated `expires_at > now()` inside the UPDATE, so nothing was written. The row
    // stays honest: it was never redeemed, and the audit trail should not claim it was.
    expect((await grantRow(token)).consumed_at).toBeNull();
  });

  it("NO HANDLE: an empty query parameter is refused before any database work", async () => {
    expect(await consumeImpersonationGrant(null)).toEqual({ ok: false, reason: "no-token" });
    expect(await consumeImpersonationGrant("")).toEqual({ ok: false, reason: "no-token" });
  });
});

suite("the grant is a permission to exchange, never a cached fact", () => {
  it("the operator was DEMOTED between minting the link and clicking it", async () => {
    const f = await makeFixture();
    const token = await mintGrant(f);
    await db.execute(sql`update platform_admins set role = 'support' where id = ${f.operatorId}`);

    expect(await consumeImpersonationGrant(token)).toEqual({ ok: false, reason: "operator-changed" });
  });

  it("the operator's ROW WAS DELETED between minting the link and clicking it", async () => {
    const f = await makeFixture();
    const token = await mintGrant(f);
    // The FK is ON DELETE CASCADE, so the grant goes with it — which is itself the refusal. Assert
    // the OUTCOME (no session) rather than the mechanism, so the test still means something if the
    // cascade is ever changed to a restrict.
    await db.execute(sql`delete from platform_admins where id = ${f.operatorId}`);

    const result = await consumeImpersonationGrant(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["operator-gone", "unknown"]).toContain(result.reason);
  });

  it("the operator's PASSWORD WAS ROTATED after the link was minted", async () => {
    const f = await makeFixture();
    // Backdated a minute so the rotation is unambiguously LATER — `sessionOutlivesPassword` resolves
    // a same-second tie toward revoked, and a test that leans on the tie proves the tie, not the rule.
    const token = await mintGrant(f, { createdSecondsAgo: 60 });
    // Written through the real column (migration 0088's BEFORE UPDATE trigger stamps it), so this
    // exercises the same revocation both session surfaces use.
    await db.execute(sql`update platform_admins set password_hash = 'salt:cafebabe' where id = ${f.operatorId}`);

    expect(await consumeImpersonationGrant(token)).toEqual({ ok: false, reason: "operator-changed" });
  });

  it("the merchant's MEMBERSHIP was removed between minting the link and clicking it", async () => {
    const f = await makeFixture();
    const token = await mintGrant(f);
    await db.execute(sql`delete from store_users where store_id = ${f.storeId} and user_id = ${f.userId}`);

    expect(await consumeImpersonationGrant(token)).toEqual({ ok: false, reason: "membership-gone" });
  });

  it("the merchant's ROLE is read from the row, not from the grant", async () => {
    const f = await makeFixture();
    const token = await mintGrant(f);
    await db.execute(sql`update store_users set role = 'staff' where store_id = ${f.storeId} and user_id = ${f.userId}`);

    const result = await consumeImpersonationGrant(token);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.role).toBe("staff");
  });
});

suite("the impersonated session is BOUNDED", () => {
  it("expires in 30 minutes, not the merchant's 7 days", async () => {
    const session: Session = {
      userId: randomUUID(),
      storeId: randomUUID(),
      role: "owner",
      email: "owner@example.test",
      name: "Pemilik",
      imp: { operatorId: randomUUID(), operatorEmail: "operator@example.test", grantId: randomUUID() },
    };
    const token = await signSession(session, undefined, IMPERSONATION_SESSION_EXPIRY);
    const claims = decodeJwt(token);
    // ⚠️ This also pins that jose PARSES the derived string at all. `setExpirationTime` takes a time
    // SPAN as a string and an absolute epoch as a number — a constant built as `${seconds}s` has to
    // be read as the former, and getting that wrong silently mints a token that expired in 1970.
    expect(claims.exp! - claims.iat!).toBe(IMPERSONATION_SESSION_MAX_AGE);
    // The operator identity is INSIDE the signature: it cannot be added or stripped by the holder.
    expect((claims.imp as { operatorEmail: string }).operatorEmail).toBe("operator@example.test");
  });

  it("a normal session is still 7 days — the bound is opt-in, not a global shortening", async () => {
    const token = await signSession({
      userId: randomUUID(),
      storeId: randomUUID(),
      role: "owner",
      email: "owner@example.test",
      name: "Pemilik",
    });
    const claims = decodeJwt(token);
    expect(claims.exp! - claims.iat!).toBe(60 * 60 * 24 * 7);
    expect(claims.imp).toBeUndefined();
  });
});

// ── NO REUSABLE BEARER MATERIAL IN A URL, and this is the half a database cannot prove ───────────
//
// The exchange being one-time is worth nothing if somebody puts a signed token back in the query
// string next quarter — and that regression type-checks, lints and passes every test above, because
// the grant table would simply stop being used. These read the files' CODE (`codeOnly`, so a comment
// explaining the old design cannot satisfy or trip them — this file's own module notes quote it).
describe("the URL carries an opaque handle and nothing else", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const ROUTE = "apps/admin/app/impersonate/route.ts";
  const ACTIONS = "apps/super-admin/lib/actions.ts";
  const SESSION = "apps/super-admin/lib/session.ts";

  it("the exchange route VERIFIES NOTHING — it spends a row", () => {
    const code = codeOnly(src(ROUTE));
    expect(code).toMatch(/consumeImpersonationGrant\s*\(/);
    // `jwtVerify` here is what made the old link replayable: a verified token is never spent.
    expect(code).not.toMatch(/jwtVerify/);
  });

  it("the super-admin mints a handle, and no signer that a URL could carry survives", () => {
    expect(codeOnly(src(ACTIONS))).toMatch(/mintGrantToken\s*\(/);
    // `signImpersonation` was the JWT mint. Its NAME may appear in the note that records why it is
    // gone (comments are stripped); a live export or call is what must not.
    expect(codeOnly(src(SESSION))).not.toMatch(/signImpersonation/);
    expect(codeOnly(src(ACTIONS))).not.toMatch(/signImpersonation/);
  });

  // Prove both assertions CAN fail. A source guard that has never been seen red is green for
  // reasons nobody has checked — this repo has been bitten by exactly that (AGENTS.md).
  it("mutation self-check: the old shape trips every claim above", () => {
    const revertedRoute = codeOnly(
      src(ROUTE).replace("consumeImpersonationGrant(req.nextUrl.searchParams.get(\"grant\"))", "jwtVerify(token, secret())"),
    );
    expect(revertedRoute).toMatch(/jwtVerify/);
    expect(revertedRoute).not.toMatch(/consumeImpersonationGrant\s*\(/);

    const revertedSession = codeOnly(`${src(SESSION)}\nexport async function signImpersonation() { return ""; }`);
    expect(revertedSession).toMatch(/signImpersonation/);
  });
});
