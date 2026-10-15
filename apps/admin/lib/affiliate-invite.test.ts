import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import { can } from "./rbac-policy";
import { accountAppUrl } from "./account-url";

// "Undang ke akun" (AFFILIATE_SPEC F-A15 / account spec ACC-14) end to end across BOTH apps: the
// Seller action mints the invitation, the account app's `acceptInvite` spends it. Real Postgres, every
// case rolled back. `requireCapability` is replaced by the real role→capability matrix (`can`), so the
// staff refusal below is the policy, not a stub's opinion; `withTenant` hands the action the test txn.

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
process.env.DATABASE_URL ??= URL ?? "postgresql://none:none@127.0.0.1:1/none";

const h = vi.hoisted(() => ({ role: "owner", storeId: "", tx: null as unknown }));
vi.mock("@/lib/rbac", () => ({
  requireCapability: async (cap: string) => {
    const { can: allowed } = await import("./rbac-policy");
    if (!allowed(h.role as never, cap as never)) throw new Error("ForbiddenError");
    return { userId: "u", storeId: h.storeId, role: h.role, email: "s@t.id", name: "S" };
  },
}));
vi.mock("@/lib/tenant", () => ({ withTenant: async <T,>(_s: string, fn: (db: unknown) => Promise<T>) => fn(h.tx) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

describe("accountAppUrl", () => {
  it("accepts an origin, trims a trailing slash, refuses anything else", () => {
    expect(accountAppUrl({ ACCOUNT_APP_URL: "https://account.tokophi.com/" })).toBe("https://account.tokophi.com");
    expect(accountAppUrl({ ACCOUNT_APP_URL: "http://100.127.67.86:4329" })).toBe("http://100.127.67.86:4329");
    for (const bad of [undefined, "", "account.tokophi.com", "https://a.b/path", "javascript:alert(1)"]) expect(accountAppUrl({ ACCOUNT_APP_URL: bad })).toBeNull();
  });
  it("staff do not hold affiliates:write; owner does", () => {
    expect(can("staff", "affiliates:write")).toBe(false);
    expect(can("owner", "affiliates:write")).toBe(true);
  });
});

let client: Sql;
type Db = ReturnType<typeof drizzle>;
let db: Db;
beforeAll(() => {
  if (!URL) return;
  client = postgres(URL, { max: 1, onnotice: () => {} });
  db = drizzle(client, { casing: "snake_case" });
});
afterAll(async () => {
  await client?.end();
});
const ROLLBACK = Symbol("rollback");
async function inTxn(fn: (tx: Db) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Db);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}
const rows = async (tx: Db, q: SQL) => (await tx.execute(q)) as unknown as Record<string, unknown>[];
let seq = 0;

suite("inviteAffiliateToAccount → acceptInvite", () => {
  it("owner mints a single-use link for an ACTIVE unlinked affiliate; the account spends it once", async () => {
    process.env.ACCOUNT_APP_URL = "http://acc.test:4329";
    const { inviteAffiliateToAccount } = await import("./actions/affiliates");
    const { acceptInvite } = await import("../../account/src/data/affiliate");
    const { upsertAccountBySub } = await import("../../account/src/data/account");
    await inTxn(async (tx) => {
      const n = `${Date.now()}-${++seq}`;
      const [acc] = await rows(tx, sql`insert into accounts (name) values ('Inv') returning id`);
      const [s] = await rows(tx, sql`insert into stores (account_id, name, slug) values (${acc.id}, 'Inv', ${"inv-" + n}) returning id`);
      const mk = async (code: string, status: string) =>
        (await rows(tx, sql`insert into affiliates (store_id, code, name, phone, status) values (${s.id}, ${code}, ${code}, ${"62812" + n.slice(-7) + code.length}, ${status}::affiliate_status) returning id`))[0].id as string;
      const active = await mk("ACTIVE", "aktif");
      const waiting = await mk("WAIT", "menunggu");
      h.storeId = s.id as string;
      h.tx = tx;

      h.role = "staff";
      await expect(inviteAffiliateToAccount(active)).rejects.toThrow("ForbiddenError");

      h.role = "owner";
      expect(await inviteAffiliateToAccount(waiting)).toMatchObject({ ok: false });
      const r = await inviteAffiliateToAccount(active);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.url.startsWith("http://acc.test:4329/affiliate/undangan?t=")).toBe(true);
      const token = new globalThis.URL(r.url).searchParams.get("t")!;
      const [stored] = await rows(tx, sql`select invite_hash from affiliates where id = ${active}`);
      expect(stored.invite_hash).not.toBe(token); // only the hash is stored

      const me = (await upsertAccountBySub(tx as never, { sub: `dev:inv-${n}@demo.local`, email: `inv-${n}@demo.local`, name: null }))!;
      expect(await acceptInvite(tx as never, me, token)).toEqual({ ok: true, affiliateId: active });
      expect(await acceptInvite(tx as never, me, token)).toMatchObject({ ok: false });
      // Linked now ⇒ no second invitation can be minted for it.
      expect(await inviteAffiliateToAccount(active)).toMatchObject({ ok: false });
    });
  });
});
