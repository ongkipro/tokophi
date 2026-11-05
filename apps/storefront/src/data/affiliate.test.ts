import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// applyAffiliate against real Postgres: the duplicate-phone answer is per STORE (F-A2).
const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
const runId = randomUUID().slice(0, 8);

let client: Sql;
let applyAffiliate: typeof import("./affiliate").applyAffiliate;
let accountId = "";
const stores: string[] = [];

beforeAll(async () => {
  if (!URL) return;
  process.env.DATABASE_URL = URL; // @tokophi/db opens its pool on import
  client = postgres(URL, { max: 1 });
  ({ applyAffiliate } = await import("./affiliate"));
  const [account] = await client<{ id: string }[]>`insert into accounts (name) values (${`Aff apply ${runId}`}) returning id`;
  accountId = account!.id;
  for (const k of ["a", "b"]) {
    const [s] = await client<{ id: string }[]>`
      insert into stores (account_id, name, slug) values (${accountId}, ${`Aff ${k}`}, ${`aff-apply-${k}-${runId}`}) returning id`;
    stores.push(s!.id);
  }
});
afterAll(async () => {
  if (!client) return;
  if (accountId) {
    await client`delete from affiliates where store_id in (select id from stores where account_id = ${accountId})`;
    await client`delete from stores where account_id = ${accountId}`;
    await client`delete from accounts where id = ${accountId}`;
  }
  await client.end();
});

const app = (phone: string) => ({
  name: "Sari Dewi",
  phone,
  email: null,
  channel: null,
  bankName: null,
  bankAccount: null,
  bankHolder: null,
});

suite("applyAffiliate (F-A2)", () => {
  it("first application creates one `menunggu` row; the same phone again answers `exists`", async () => {
    expect(await applyAffiliate(stores[0]!, app("6281200000001"))).toBe("created");
    expect(await applyAffiliate(stores[0]!, app("6281200000001"))).toBe("exists");
    const rows = await client<{ status: string }[]>`
      select status::text from affiliates where store_id = ${stores[0]!} and phone = '6281200000001'`;
    expect(rows).toEqual([{ status: "menunggu" }]);
  });

  it("the same phone may apply to ANOTHER store (the duplicate check is per store)", async () => {
    expect(await applyAffiliate(stores[1]!, app("6281200000001"))).toBe("created");
  });
});
