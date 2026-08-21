import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import type { Session } from "./auth";
import type { Capability } from "./rbac-policy";

/**
 * A MERCHANT WRITE MADE UNDER IMPERSONATION NAMES BOTH PARTIES (Task 4.11 / SEC-10).
 *
 * Before this, the audit trail ended at "Impersonate toko oleh …". Everything the operator did next
 * was indistinguishable from the owner's own work — in `platform_activity`, on the merchant's
 * screens, and in any reconstruction of "who changed this?". The requirement is dual identity on
 * DOWNSTREAM privileged actions, not merely on the door.
 *
 * `requireCapability` is the only place that sees all of them (AGENTS.md: "every mutating action
 * calls `await requireCapability(...)` at the top — this is the security boundary"), so that is
 * where the record is written, and this suite drives the real function against real Postgres.
 */

const h = vi.hoisted(() => ({
  db: null as unknown as PostgresJsDatabase,
  session: null as Session | null,
}));

vi.mock("@tokophi/db", async () => ({
  get db() {
    return h.db;
  },
  schema: await import("@tokophi/db/schema"),
}));
vi.mock("./auth", () => ({ getSession: async () => h.session }));
// Not the subject here, and it opens a tenant transaction of its own. Task 4.10 owns that gate.
vi.mock("./data/billing", () => ({ getBilling: async () => null }));

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: Sql;
let db: PostgresJsDatabase;
let requireCapability: (cap: Capability) => Promise<Session>;

let storeId = "";
const operatorEmail = "operator@example.test";
const merchantEmail = "pemilik@example.test";

async function auditFor(store: string): Promise<{ text: string; kind: string }[]> {
  return (await db.execute(sql`
    select text, kind from platform_activity where store_id = ${store} order by ts asc
  `)) as unknown as { text: string; kind: string }[];
}

beforeAll(async () => {
  if (!URL) return;
  client = postgres(URL, { max: 4 });
  db = drizzle(client, { casing: "snake_case" });
  h.db = db;
  const [account] = (await db.execute(sql`
    insert into accounts (name) values ('Impersonation audit') returning id
  `)) as unknown as { id: string }[];
  const [store] = (await db.execute(sql`
    insert into stores (account_id, name, slug) values (${account.id}, 'Audit', ${`imp-audit-${randomUUID()}`}) returning id
  `)) as unknown as { id: string }[];
  storeId = store.id;
  ({ requireCapability } = await import("./rbac"));
});

afterAll(async () => {
  if (client) await client.end();
});

const impersonated: () => Session = () => ({
  userId: randomUUID(),
  storeId,
  role: "owner",
  email: merchantEmail,
  name: "Pemilik",
  imp: { operatorId: randomUUID(), operatorEmail, grantId: randomUUID() },
});

suite("a gated write under impersonation is attributable to the operator AND the merchant", () => {
  it("records both identities, the capability, and the store", async () => {
    h.session = impersonated();
    const before = (await auditFor(storeId)).length;

    const session = await requireCapability("products:write");
    expect(session.imp?.operatorEmail).toBe(operatorEmail);

    const rows = await auditFor(storeId);
    expect(rows).toHaveLength(before + 1);
    const line = rows.at(-1)!;
    // The MERCHANT is the `store_id` on the row (which store's history this belongs to) plus the
    // account the operator was acting as; the OPERATOR is the human being held responsible.
    expect(line.text).toContain(operatorEmail);
    expect(line.text).toContain(merchantEmail);
    expect(line.text).toContain("products:write");
    expect(line.kind).toBe("admin");
  });

  it("says an AUTHORISATION happened, not that data changed", async () => {
    h.session = impersonated();
    await requireCapability("orders:write");
    const line = (await auditFor(storeId)).at(-1)!;
    // ⚠️ The gate runs BEFORE the write, so the write may still fail validation or roll back.
    // Claiming "menyimpan"/"mengubah" here would be `markLabelsPrinted`'s mistake — reporting what
    // you were asked to do rather than what you did — pointed at the audit log itself.
    expect(line.text).toMatch(/memakai izin/);
    expect(line.text).not.toMatch(/menyimpan|mengubah|berhasil/);
  });

  it("a merchant's OWN session writes nothing — this is not a general activity log", async () => {
    h.session = { ...impersonated(), imp: undefined };
    const before = (await auditFor(storeId)).length;
    await requireCapability("products:write");
    expect(await auditFor(storeId)).toHaveLength(before);
  });

  it("FAILS CLOSED: if the record cannot be written, the action does not proceed", async () => {
    // A store id that exists in no row. `platform_activity.store_id` is a real foreign key, so the
    // insert raises 23503 — the same shape a database outage produces. An operator write that cannot
    // be attributed must not happen at all, which is the whole point of putting this at the gate.
    h.session = { ...impersonated(), storeId: "00000000-0000-0000-0000-0000000000ff" };
    await expect(requireCapability("products:write")).rejects.toThrow();
  });
});
