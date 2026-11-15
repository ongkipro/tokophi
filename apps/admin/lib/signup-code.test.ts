import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ADR 0019 — THE SIGNUP BOUNDARY decides the provider from the signup code, against the REAL database:
//   · no code → KiriminAja, no Mengantar row at all ("default pakai KiriminAja");
//   · an ACTIVE Mengantar code → a Mengantar store carrying the code, its account queued — with the owner's
//     consent ONLY when the sentence was shown for that code, otherwise waiting for the owner's click;
//   · an ACTIVE KiriminAja code → KiriminAja, no row;
//   · an unknown, inactive or malformed code → SignupCodeError, and NOTHING is created (no store, no user).
// `provisionStore` is imported for real (owner pool on the test DB); the Partner API is never reached:
// MENGANTAR_ENV is unset, so a consented row parks as `configuration_blocked` without a network call.
const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const runId = randomUUID().slice(0, 6).toUpperCase();
const MG = `MG-${runId}`;
const KA = `KA-${runId}`;
const OFF = `OFF-${runId}`;

let client: Sql;
let prov: typeof import("./provision");
const emails: string[] = [];

beforeAll(async () => {
  if (!URL_) return;
  process.env.DATABASE_URL = URL_;
  process.env.SIGNUP_ENABLED = "true";
  delete process.env.MENGANTAR_ENV;
  client = postgres(URL_, { max: 2, onnotice: () => {} });
  await client`insert into signup_codes (code, shipping_provider, active) values (${MG}, 'mengantar', true), (${KA}, 'kiriminaja', true), (${OFF}, 'mengantar', false)`;
  prov = await import("./provision");
});

const tidy = async (q: () => Promise<unknown>) => {
  try {
    await q();
  } catch (e) {
    console.warn("[signup-code.test] cleanup:", e instanceof Error ? e.message : e);
  }
};
afterAll(async () => {
  if (!client) return;
  try {
    const stores = await client<{ id: string; account_id: string }[]>`
      select s.id, s.account_id from stores s join store_users su on su.store_id = s.id join users u on u.id = su.user_id where u.email in ${client(emails)}`;
    for (const s of stores) {
      for (const t of ["store_mengantar_accounts", "platform_activity", "store_stats", "store_settings", "locations", "store_users"]) {
        await tidy(() => client`delete from ${client(t)} where store_id = ${s.id}`);
      }
      await tidy(() => client`delete from stores where id = ${s.id}`);
      await tidy(() => client`delete from accounts where id = ${s.account_id}`);
    }
    await tidy(() => client`delete from users where email in ${client(emails)}`);
    await tidy(() => client`delete from signup_codes where code in ${client([MG, KA, OFF])}`);
  } finally {
    await client.end();
  }
});

async function signup(signupCode: string | undefined, mengantarConsent = false) {
  const email = `kode-${runId.toLowerCase()}-${emails.length}@example.test`;
  emails.push(email);
  const r = await prov.provisionStore({ storeName: `Toko Kode ${runId} ${emails.length}`, ownerName: "Pemilik", email, passwordHash: "x:y", signupCode, mengantarConsent });
  const [st] = await client<{ shipping_provider: string; signup_code: string | null }[]>`select shipping_provider, signup_code from stores where id = ${r.storeId}`;
  return { r, st, email };
}
/** The enqueue's background attempt settles fast (no network); wait for it rather than race it. */
async function accountRow(storeId: string) {
  for (let i = 0; i < 40; i++) {
    const [row] = await client<{ state: string; consented_at: Date | null; consent_source: string | null; last_error_code: string | null }[]>`
      select state, consented_at, consent_source, last_error_code from store_mengantar_accounts where store_id = ${storeId}`;
    if (!row || row.last_error_code) return row ?? null;
    await new Promise((res) => setTimeout(res, 50));
  }
  return (await client<{ state: string; consented_at: Date | null; consent_source: string | null; last_error_code: string | null }[]>`
    select state, consented_at, consent_source, last_error_code from store_mengantar_accounts where store_id = ${storeId}`)[0] ?? null;
}

suite("provisionStore — the signup code decides the provider (ADR 0019)", () => {
  it("no code → KiriminAja, no signup code, and NO Mengantar row", async () => {
    const { r, st } = await signup(undefined);
    expect(r.shippingProvider).toBe("kiriminaja");
    expect(st).toEqual({ shipping_provider: "kiriminaja", signup_code: null });
    expect(await accountRow(r.storeId)).toBeNull();
  });

  it("an active Mengantar code (typed in lower case) + consent shown → Mengantar store, code recorded, account queued WITH the owner's consent", async () => {
    const { r, st } = await signup(`  ${MG.toLowerCase()} `, true);
    expect(st).toEqual({ shipping_provider: "mengantar", signup_code: MG });
    const row = await accountRow(r.storeId);
    expect(row).toMatchObject({ state: "pending", consent_source: "signup" });
    expect(row!.consented_at).not.toBeNull();
    // A self-serve store is born unapproved; nothing is registered before approval (D15).
    expect(["awaiting_approval", "configuration_blocked"]).toContain(row!.last_error_code);
  });

  it("a Mengantar code WITHOUT the consent flag → Mengantar store, account waits for the owner's click (no consent recorded)", async () => {
    const { r, st } = await signup(MG, false);
    expect(st.shipping_provider).toBe("mengantar");
    const row = await accountRow(r.storeId);
    expect(row).toMatchObject({ state: "pending", last_error_code: "awaiting_consent" });
    expect(row!.consented_at).toBeNull();
  });

  it("an active KiriminAja code → KiriminAja, code recorded, NO row — even with a stray consent flag", async () => {
    const { r, st } = await signup(KA, true);
    expect(st).toEqual({ shipping_provider: "kiriminaja", signup_code: KA });
    expect(await accountRow(r.storeId)).toBeNull();
  });

  it("an inactive, unknown or malformed code is REFUSED and creates nothing", async () => {
    for (const bad of [OFF, `NOPE-${runId}`, "a b"]) {
      const before = emails.length;
      await expect(signup(bad, true)).rejects.toBeInstanceOf(prov.SignupCodeError);
      const [{ n }] = await client<{ n: number }[]>`select count(*)::int as n from users where email = ${emails[before]}`;
      expect(n).toBe(0);
    }
  });

  it("the usage count is derived: two stores carry the Mengantar code", async () => {
    const [{ n }] = await client<{ n: number }[]>`select count(*)::int as n from stores where signup_code = ${MG}`;
    expect(n).toBe(2);
  });

  it("the DB refuses a code that does not exist (FK) and a non-canonical code (CHECK)", async () => {
    const [s] = await client<{ id: string }[]>`select id from stores where signup_code = ${MG} limit 1`;
    await expect(client`update stores set signup_code = ${`GHOST-${runId}`} where id = ${s.id}`).rejects.toThrow(/foreign key/i);
    await expect(client`insert into signup_codes (code, shipping_provider) values ('lower-case', 'mengantar')`).rejects.toThrow(/check/i);
    await expect(client`update stores set shipping_provider = 'jne' where id = ${s.id}`).rejects.toThrow(/check/i);
  });

  it("signup_codes is invisible to the merchant role (RLS on, no policy)", async () => {
    const seen = await client.begin(async (tx) => {
      await tx`set local role tokophi_app`;
      return (await tx<{ n: number }[]>`select count(*)::int as n from signup_codes`)[0].n;
    });
    expect(seen).toBe(0);
  });
});
