import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MengantarPartnerConfig } from "@tokophi/lib/provider-config";

// Mengantar Partner Business API — the store's OWN seller account: registration, idempotency, the 409
// path, a lost answer reconciled through the seller list, provisioning that never blocks, rotation, and
// tenant isolation of the sealed key. REAL Postgres; the Partner API is a FAKE fetch (nothing leaves).
const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const runId = randomUUID().slice(0, 8);

let client: Sql;
let acct: typeof import("@tokophi/db/mengantar-account");
let accountId = "";
const storeIds: string[] = [];
const userIds: string[] = [];

const PCFG: MengantarPartnerConfig = {
  env: "sandbox",
  envSource: "default",
  partnerBase: "https://partner.test",
  publicBase: "https://public.test",
  partnerId: "tokophi-test",
  partnerSecret: "partner-secret-test-0001",
  source: "env",
};

type Route = "register" | "list" | "key" | "regenerate";
type Reply = { status?: number; body: unknown; headers?: Record<string, string> } | Error;
/** A Partner stand-in that records every call and answers per route (a function = dynamic). */
function fakePartner(answers: Partial<Record<Route, Reply | ((body: Record<string, unknown>, n: number) => Reply | Promise<Reply>)>>) {
  const calls: { route: Route; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace("/api/partner/v1", "");
    const route: Route = path === "/sellers" ? "register" : path === "/sellers/list" ? "list" : path === "/sellers/api-key" ? "key" : "regenerate";
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ route, body });
    const a = answers[route];
    const r = typeof a === "function" ? await a(body, calls.filter((c) => c.route === route).length) : a;
    if (!r) return new Response(JSON.stringify({ success: false, code: "UNEXPECTED", message: route }), { status: 500 });
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, count: (r: Route) => calls.filter((c) => c.route === r).length };
}
const opts = (fetch: typeof globalThis.fetch) => ({ source: "pengaturan" as const, partner: { cfg: PCFG, fetch } });
const listed = (ext: string, sellerId: string, active = true) => ({ body: { success: true, data: { sellers: [{ sellerId, externalUserId: ext, active }], total: 1 } } });
const emptyList = { body: { success: true, data: { sellers: [], total: 0 } } };

async function newStore(o: { approved?: boolean; phone?: string | null } = {}) {
  const n = storeIds.length;
  const [st] = await client<{ id: string }[]>`
    insert into stores (account_id, name, slug, status, approved_at)
    values (${accountId}, ${`Toko MG ${runId}`}, ${`mga-${runId}-${n}`}, 'active', ${o.approved === false ? null : new Date()}) returning id`;
  storeIds.push(st.id);
  const [u] = await client<{ id: string }[]>`insert into users (email, name) values (${`owner-${runId}-${n}@example.test`}, 'Pemilik') returning id`;
  userIds.push(u.id);
  await client`insert into store_users (store_id, user_id, role, accepted_at) values (${st.id}, ${u.id}, 'owner', now())`;
  await client`insert into store_settings (store_id, sender_phone) values (${st.id}, ${o.phone === undefined ? "081234567890" : o.phone})`;
  return { storeId: st.id, ext: `tokophi:sandbox:store:${st.id}`, email: `owner-${runId}-${n}@example.test` };
}
const row = async (storeId: string) =>
  (await client<{ state: string; seller_id: string | null; api_key_enc: string | null; key_version: number; last_error_code: string | null; retry_after_at: Date | null; partner_id: string | null }[]>`
    select state, seller_id, api_key_enc, key_version, last_error_code, retry_after_at, partner_id from store_mengantar_accounts where store_id = ${storeId}`)[0];

beforeAll(async () => {
  if (!URL_) return;
  process.env.DATABASE_URL = URL_;
  process.env.INTEGRATION_TOKEN_KEY ??= "test-integration-key-not-a-secret-0001";
  delete process.env.MENGANTAR_ENV;
  client = postgres(URL_, { max: 4, onnotice: () => {} });
  acct = await import("@tokophi/db/mengantar-account");
  const [a] = await client<{ id: string }[]>`insert into accounts (name) values (${`MGA ${runId}`}) returning id`;
  accountId = a.id;
});

const tidy = async (q: () => Promise<unknown>) => {
  try {
    await q();
  } catch (e) {
    console.warn("[mengantar-account.test] cleanup:", e instanceof Error ? e.message : e);
  }
};
afterAll(async () => {
  if (!client) return;
  try {
    for (const s of storeIds) {
      await tidy(() => client`delete from store_mengantar_accounts where store_id = ${s}`);
      await tidy(() => client`delete from store_settings where store_id = ${s}`);
      await tidy(() => client`delete from store_users where store_id = ${s}`);
      await tidy(() => client`delete from stores where id = ${s}`);
    }
    for (const u of userIds) await tidy(() => client`delete from users where id = ${u}`);
    await tidy(() => client`delete from accounts where id = ${accountId}`);
  } finally {
    await client.end();
  }
});

suite("connectStoreMengantar — register with the owner's TokoΦ email, prove ownership, seal", () => {
  it("201 → list proof → connected; the key is sealed (never stored plain) and the opener hands it out", async () => {
    const { storeId, ext, email } = await newStore();
    const p = fakePartner({
      register: { status: 201, body: { success: true, alreadyRegistered: false, data: { sellerId: `s-${runId}-1`, email, apiKey: `API-KEY-${runId}-1` } } },
      list: listed(ext, `s-${runId}-1`),
    });
    const r = await acct.connectStoreMengantar(storeId, opts(p.fetch));
    expect(r.state).toBe("connected");
    expect(p.calls.map((c) => c.route)).toEqual(["register", "list"]);
    expect(p.calls[0].body).toEqual({ name: `Toko MG ${runId}`, email, phone: "6281234567890", externalUserId: ext });
    const db = await row(storeId);
    expect(db).toMatchObject({ state: "connected", seller_id: `s-${runId}-1`, key_version: 1, partner_id: "tokophi-test" });
    expect(db.api_key_enc).toMatch(/^v1:/);
    expect(db.api_key_enc).not.toContain(`API-KEY-${runId}-1`);
    const open = await acct.openStoreMengantar(storeId);
    expect(open).toMatchObject({ ok: true, sellerId: `s-${runId}-1`, env: "sandbox", cfg: { env: "sandbox", base: "https://sandbox.mengantar.com", key: `API-KEY-${runId}-1` } });
  });

  it("idempotent: two concurrent connects register ONCE; a connected store is never re-registered", async () => {
    const { storeId, ext } = await newStore();
    const p = fakePartner({
      register: async () => {
        await new Promise((r) => setTimeout(r, 120));
        return { status: 201, body: { success: true, data: { sellerId: `s-${runId}-2`, apiKey: `API-KEY-${runId}-2` } } };
      },
      list: listed(ext, `s-${runId}-2`),
    });
    const [a, b] = await Promise.all([acct.connectStoreMengantar(storeId, opts(p.fetch)), acct.connectStoreMengantar(storeId, opts(p.fetch))]);
    expect(p.count("register")).toBe(1);
    expect([a.state, b.state]).toContain("connected");
    const again = await acct.connectStoreMengantar(storeId, opts(p.fetch));
    expect(again.state).toBe("connected");
    expect(p.count("register")).toBe(1);
  });

  it("409 EMAIL_ALREADY_REGISTERED → email_taken, no key, the opener refuses (store stays on the default provider)", async () => {
    const { storeId } = await newStore();
    const p = fakePartner({ register: { status: 409, body: { success: false, code: "EMAIL_ALREADY_REGISTERED", message: "Email already registered" } } });
    const r = await acct.connectStoreMengantar(storeId, opts(p.fetch));
    expect(r.state).toBe("email_taken");
    expect(r.message).toMatch(/sudah terdaftar sebagai akun Mengantar/);
    expect(await row(storeId)).toMatchObject({ state: "email_taken", seller_id: null, api_key_enc: null });
    expect(await acct.openStoreMengantar(storeId)).toEqual({ ok: false, reason: "not_connected" });
    // The retry sweep does not hammer a 409.
    const sweep = await acct.retryMengantarAccounts({ partner: { cfg: PCFG, fetch: p.fetch }, limit: 50 });
    expect(p.count("register")).toBe(1);
    expect(sweep.picked).toBeGreaterThanOrEqual(0);
  });

  it("a register whose answer is LOST is reconciled through the seller list before anything else", async () => {
    const { storeId, ext } = await newStore();
    const p = fakePartner({
      register: new TypeError("socket hang up"),
      list: listed(ext, `s-${runId}-3`),
      key: { body: { success: true, data: { sellerId: `s-${runId}-3`, apiKey: `API-KEY-${runId}-3` } } },
    });
    const r = await acct.connectStoreMengantar(storeId, opts(p.fetch));
    expect(r.state).toBe("connected");
    expect(p.calls.map((c) => c.route)).toEqual(["register", "list", "list", "key"]);
    expect(p.calls[1].body).toEqual({ externalUserId: ext });
    expect(await row(storeId)).toMatchObject({ state: "connected", seller_id: `s-${runId}-3` });
  });

  it("lost answer + the list does not show it yet → stays `registering`; after the stale window the SAME register is repeated (idempotent)", async () => {
    const { storeId, ext } = await newStore();
    let lost = true;
    const p = fakePartner({
      register: () => (lost ? new TypeError("timeout") : { status: 200, body: { success: true, alreadyRegistered: true, data: { sellerId: `s-${runId}-4`, apiKey: `API-KEY-${runId}-4` } } }),
      list: (_b, n) => (n === 1 ? emptyList : listed(ext, `s-${runId}-4`)),
    });
    expect((await acct.connectStoreMengantar(storeId, opts(p.fetch))).state).toBe("registering");
    expect(await row(storeId)).toMatchObject({ state: "registering", last_error_code: "outcome_unknown" });
    // A second click inside the window does NOT register again.
    await acct.connectStoreMengantar(storeId, opts(p.fetch));
    expect(p.count("register")).toBe(1);
    lost = false;
    const later = Date.now() + acct.MG_CLAIM_STALE_MS + 1000;
    const r = await acct.connectStoreMengantar(storeId, { ...opts(p.fetch), now: () => later });
    expect(r.state).toBe("connected");
    expect(p.calls.filter((c) => c.route === "register").every((c) => c.body.externalUserId === ext)).toBe(true);
  });

  it("the ownership proof fails (list names another seller) → nothing sealed", async () => {
    const { storeId, ext } = await newStore();
    const p = fakePartner({
      register: { status: 201, body: { success: true, data: { sellerId: `s-${runId}-5`, apiKey: `API-KEY-${runId}-5` } } },
      list: listed(ext, "somebody-else"),
    });
    expect((await acct.connectStoreMengantar(storeId, opts(p.fetch))).state).toBe("pending");
    expect(await row(storeId)).toMatchObject({ seller_id: null, api_key_enc: null, last_error_code: "ownership_unproven" });
  });

  it("429 stores Retry-After and the next attempt (even a click) waits for it", async () => {
    const { storeId } = await newStore();
    const p = fakePartner({ register: { status: 429, body: { success: false, code: "RATE_LIMITED", message: "slow down" }, headers: { "Retry-After": "120" } } });
    expect((await acct.connectStoreMengantar(storeId, opts(p.fetch))).state).toBe("pending");
    const r = await row(storeId);
    expect(r.last_error_code).toBe("RATE_LIMITED");
    expect(r.retry_after_at!.getTime()).toBeGreaterThan(Date.now() + 100_000);
    await acct.requeueMengantar(storeId, opts(p.fetch));
    await acct.connectStoreMengantar(storeId, opts(p.fetch));
    expect(p.count("register")).toBe(1);
  });

  it("a self-serve store that is not approved yet is queued, never registered (its email is unproven)", async () => {
    const { storeId } = await newStore({ approved: false });
    const p = fakePartner({});
    const r = await acct.connectStoreMengantar(storeId, opts(p.fetch));
    expect(r.state).toBe("pending");
    expect(p.calls).toHaveLength(0);
    expect((await row(storeId)).last_error_code).toBe("awaiting_approval");
  });

  it("no usable phone → failed with a seller instruction, no call", async () => {
    const { storeId } = await newStore({ phone: "021-555-0000" });
    const p = fakePartner({});
    const r = await acct.connectStoreMengantar(storeId, opts(p.fetch));
    expect(r.state).toBe("failed");
    expect(r.message).toMatch(/nomor HP pengirim/);
    expect(p.calls).toHaveLength(0);
  });

  it("no Partner origin for the env (production today) → queued, no call, store unaffected", async () => {
    const { storeId } = await newStore();
    const p = fakePartner({});
    const r = await acct.connectStoreMengantar(storeId, { source: "signup", partner: { cfg: { ...PCFG, partnerBase: null }, fetch: p.fetch } });
    expect(r.state).toBe("pending");
    expect(p.calls).toHaveLength(0);
    expect((await row(storeId)).last_error_code).toBe("configuration_blocked");
  });
});

suite("provisioning never waits on, or fails because of, Mengantar", () => {
  it("enqueue returns immediately while the provider hangs, and leaves a queued row", async () => {
    const { storeId } = await newStore();
    const hang = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const t0 = Date.now();
    await acct.enqueueMengantarConnect(storeId, { source: "signup", partner: { cfg: PCFG, fetch: hang, timeoutMs: 50 } });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(["pending", "registering"]).toContain((await row(storeId)).state);
  });

  it("enqueue never throws — not even for a store id that does not exist", async () => {
    await expect(acct.enqueueMengantarConnect(randomUUID(), { source: "signup", partner: { cfg: PCFG, fetch: fakePartner({}).fetch } })).resolves.toBeUndefined();
  });
});

suite("rotation — regenerate ONCE, seal v+1, recover a lost answer with get-key (never a 2nd regenerate)", () => {
  async function connected() {
    const s = await newStore();
    const p = fakePartner({
      register: { status: 201, body: { success: true, data: { sellerId: `rs-${s.storeId.slice(0, 8)}`, apiKey: "API-OLDOLDOLDOLD" } } },
      list: listed(s.ext, `rs-${s.storeId.slice(0, 8)}`),
    });
    await acct.connectStoreMengantar(s.storeId, opts(p.fetch));
    return s;
  }

  it("replaces the key and bumps the version; the old blob is gone", async () => {
    const { storeId } = await connected();
    const before = await row(storeId);
    const p = fakePartner({ regenerate: (b) => ({ body: { success: true, data: { sellerId: b.sellerId, apiKey: "API-NEWNEWNEWNEW", callbackSecret: null } } }) });
    expect((await acct.rotateStoreMengantarKey(storeId, { partner: { cfg: PCFG, fetch: p.fetch } })).state).toBe("connected");
    const after = await row(storeId);
    expect(after.key_version).toBe(before.key_version + 1);
    expect(after.api_key_enc).not.toBe(before.api_key_enc);
    const open = await acct.openStoreMengantar(storeId);
    expect(open.ok && open.cfg.key).toBe("API-NEWNEWNEWNEW");
  });

  it("a lost regenerate answer → recovered with get-key; regenerate is called exactly once", async () => {
    const { storeId } = await connected();
    const p = fakePartner({ regenerate: new TypeError("reset"), key: (b) => ({ body: { success: true, data: { sellerId: b.sellerId, apiKey: "API-RECOVERED00" } } }) });
    expect((await acct.rotateStoreMengantarKey(storeId, { partner: { cfg: PCFG, fetch: p.fetch } })).state).toBe("connected");
    expect(p.count("regenerate")).toBe(1);
    expect(p.count("key")).toBe(1);
    const open = await acct.openStoreMengantar(storeId);
    expect(open.ok && open.cfg.key).toBe("API-RECOVERED00");
  });

  it("while the fence is up the opener refuses (no booking against a key that may be dead)", async () => {
    const { storeId } = await connected();
    const p = fakePartner({ regenerate: new TypeError("reset"), key: new TypeError("reset") });
    expect((await acct.rotateStoreMengantarKey(storeId, { partner: { cfg: PCFG, fetch: p.fetch } })).state).toBe("rotating");
    expect(await acct.openStoreMengantar(storeId)).toEqual({ ok: false, reason: "rotating" });
  });
});

suite("tenant isolation — a store can never read another store's sealed key", () => {
  it("under the tenant role, store B sees 0 rows of store A; A sees its own; a cross-store write is refused", async () => {
    const a = await newStore();
    const b = await newStore();
    for (const s of [a, b]) {
      await client`insert into store_mengantar_accounts (store_id, env, external_user_id, state) values (${s.storeId}, 'sandbox', ${s.ext}, 'pending') on conflict do nothing`;
    }
    const asTenant = async <T>(storeId: string, fn: (tx: Sql) => Promise<T>) =>
      client.begin(async (tx) => {
        await tx`select set_config('app.store_id', ${storeId}, true)`;
        await tx`set local role tokophi_app`;
        return fn(tx as unknown as Sql);
      });
    const seenByB = await asTenant(b.storeId, (tx) => tx`select store_id from store_mengantar_accounts where store_id = ${a.storeId}`);
    expect(seenByB).toHaveLength(0);
    const own = await asTenant(a.storeId, (tx) => tx`select store_id from store_mengantar_accounts where store_id = ${a.storeId}`);
    expect(own).toHaveLength(1);
    await expect(
      asTenant(b.storeId, (tx) => tx`insert into store_mengantar_accounts (store_id, env, external_user_id) values (${a.storeId}, 'production', ${`tokophi:store:${a.storeId}`})`),
    ).rejects.toThrow(/row-level security/);
  });

  it("the DB refuses an externalUserId that does not name the row's own store, and one seller id per env", async () => {
    const a = await newStore();
    const b = await newStore();
    await expect(client`insert into store_mengantar_accounts (store_id, env, external_user_id) values (${a.storeId}, 'sandbox', ${b.ext})`).rejects.toThrow(/sma_ext_check/);
    await client`insert into store_mengantar_accounts (store_id, env, external_user_id, seller_id) values (${a.storeId}, 'sandbox', ${a.ext}, ${`dup-${runId}`})`;
    await expect(client`insert into store_mengantar_accounts (store_id, env, external_user_id, seller_id) values (${b.storeId}, 'sandbox', ${b.ext}, ${`dup-${runId}`})`).rejects.toThrow(/sma_seller_uniq/);
  });

  it("a sealed blob copied into another store's row does not decrypt (scope binds store + env + seller + version)", async () => {
    const a = await newStore();
    const b = await newStore();
    const { encryptSecret } = await import("@tokophi/lib/crypto");
    const blob = encryptSecret("API-AAAAAAAAAAAA", acct.mengantarKeyScope(a.storeId, "sandbox", `sa-${runId}`, 1));
    await client`insert into store_mengantar_accounts (store_id, env, external_user_id, seller_id, state, api_key_enc, key_version) values (${b.storeId}, 'sandbox', ${b.ext}, ${`sb-${runId}`}, 'connected', ${blob}, 1)`;
    expect(await acct.openStoreMengantar(b.storeId)).toEqual({ ok: false, reason: "key_unreadable" });
  });
});

describe("sellerConnectRefusal — the Seller button cannot spend the shared partner budget", () => {
  it("blocked is an operator case; one attempt per minute otherwise; a new store goes straight through", async () => {
    const { sellerConnectRefusal, SELLER_CONNECT_COOLDOWN_MS } = await import("@tokophi/db/mengantar-account");
    const now = Date.parse("2026-11-05T08:00:00Z");
    const ago = (ms: number) => new Date(now - ms);
    expect(sellerConnectRefusal({ state: "blocked", updatedAt: ago(10 * 60_000) }, now)).toMatch(/ditinjau tim TokoΦ/);
    expect(sellerConnectRefusal({ state: "failed", updatedAt: ago(5_000) }, now)).toMatch(/Coba lagi dalam 55 detik/);
    expect(sellerConnectRefusal({ state: "email_taken", updatedAt: ago(SELLER_CONNECT_COOLDOWN_MS - 1) }, now)).toMatch(/1 detik/);
    expect(sellerConnectRefusal({ state: "failed", updatedAt: ago(SELLER_CONNECT_COOLDOWN_MS) }, now)).toBeNull();
    expect(sellerConnectRefusal({ state: "none", updatedAt: null }, now)).toBeNull();
    // A key rotation in progress is not a registration to retry.
    expect(sellerConnectRefusal({ state: "rotating", updatedAt: ago(10 * 60_000) }, now)).toMatch(/sedang diperbarui/);
  });
});
