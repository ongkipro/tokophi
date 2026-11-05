// Mengantar Partner Business API — SANDBOX end-to-end through the REAL code paths.
//
// What it does (in order; each step prints non-secret facts only — ids, states, counts, never a key,
// a secret, an email or a phone):
//   1. Partner seller list by this store's externalUserId (signing + partner id + clock).
//   2. connectStoreMengantar → register the test seller with the owner email you pass → ownership
//      proof → sealed key → `connected`. 3. A repeat register with the same id (idempotent).
//   4. Area search + 5. GET /time with the STORE's key (the sandbox is expected to list no slots).
//   6. Rates for a test order (Cilandak → Kebayoran Baru, Jakarta Selatan) via mengantarOrderRates.
//   7. Book JT as DROP-OFF via bookMengantar (claim, per-store lease, identity-first persist, NO ledger
//      debit), then 8. cancel it via cancelMengantar and read back what the deleted order answers.
//   9. A second JT booking, sandbox simulation ON DELIVERY → sweep → DELIVERED → sweep.
//  10. Negative: an order stamped `mg_env=production` is refused by the opener (no call).
//
// REFUSALS (not advice): the database must be `tokophi_shipping`; MENGANTAR_ENV must be `sandbox`;
// NODE_ENV must not be `test`; INTEGRATION_TOKEN_KEY must be set; `--confirm-sandbox` must be passed
// for any network step (`--check` runs only the no-network checks).
//
// HOW TO RUN (from the worktree root; the partner credential comes ONLY through secrets-env, mapped to
// the runtime names in-process — never typed on a command line):
//
//   cd apps/admin    # so tsx picks up the `@/…` paths of apps/admin/tsconfig.json
//   DATABASE_URL=postgresql://tokophi:tokophi@localhost:5433/tokophi_shipping MENGANTAR_ENV=sandbox \
//   INTEGRATION_TOKEN_KEY=<dev key, ≥16 chars> NODE_OPTIONS="--import $PWD/../../ops/mengantar-live-hooks.mjs" \
//   secrets-env run -- npx tsx ../../ops/mengantar-sandbox-e2e.ts \
//     --email <owner-supplied test inbox> --phone 08xxxxxxxxxx --check
//
//   …then the same with `--confirm-sandbox` instead of `--check`. Optional `--tag <name>` keeps the test
//   store distinct (default `e2e`). Residue: the sandbox seller and its orders stay on the partner
//   account (there is no delete-seller route) — record the printed seller id in BUILD-LOG.
//
// The sandbox can serve Cloudflare 502 pages for minutes: steps 1–3 are safe to re-run; step 7 is NOT
// blindly re-runnable — an unclear booking answer is left `unknown` and must be reconciled first.

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const CHECK = args.includes("--check");
const CONFIRM = args.includes("--confirm-sandbox");
const TAG = (arg("tag") ?? "e2e").replace(/[^a-z0-9-]/gi, "").slice(0, 20) || "e2e";
const EMAIL = arg("email")?.trim().toLowerCase();
const PHONE = arg("phone")?.trim();

function refuse(why: string): never {
  console.error(`mengantar-sandbox-e2e REFUSED: ${why}`);
  process.exit(2);
}
const say = (step: string, facts: Record<string, unknown>) => console.log(`[${step}]`, JSON.stringify(facts));

async function main() {
  // ── Refusals ─────────────────────────────────────────────────────────────────────────────────
  const dbUrl = process.env.DATABASE_URL ?? "";
  let dbName = "";
  try {
    dbName = new URL(dbUrl).pathname.replace(/^\//, "");
  } catch {
    refuse("DATABASE_URL is not a URL");
  }
  if (dbName !== "tokophi_shipping") refuse(`database must be tokophi_shipping (got ${JSON.stringify(dbName)})`);
  if (process.env.MENGANTAR_ENV !== "sandbox") refuse("MENGANTAR_ENV must be exactly 'sandbox'");
  if (process.env.NODE_ENV === "test") refuse("NODE_ENV=test (the client refuses writes there)");
  if (!process.env.INTEGRATION_TOKEN_KEY || process.env.INTEGRATION_TOKEN_KEY.length < 16) refuse("INTEGRATION_TOKEN_KEY must be set (≥16 chars) to seal the seller key");
  if (!CHECK && !CONFIRM) refuse("pass --check (no network) or --confirm-sandbox");
  if (!EMAIL || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(EMAIL)) refuse("--email <owner-supplied test inbox> is required");
  // Map the secrets-env names onto the runtime names, in-process only.
  const pid = process.env.GERAIEXPRESS_MENGANTAR_SANDBOX_PARTNER_ID;
  const psec = process.env.GERAIEXPRESS_MENGANTAR_SANDBOX_SECRET;
  if (!pid || !psec) refuse("GERAIEXPRESS_MENGANTAR_SANDBOX_PARTNER_ID / _SECRET not in the environment — run through `secrets-env run --`");
  process.env.MENGANTAR_PARTNER_ID = pid;
  process.env.MENGANTAR_PARTNER_SECRET = psec;

  const { db, schema, client } = await import("@tokophi/db");
  const { eq, sql } = await import("drizzle-orm");
  const { getProviderConfig } = await import("@tokophi/lib/provider-config");
  const { partnerListSellers, partnerRegisterSeller, partnerPhone, mengantarExternalUserId } = await import("@tokophi/lib/mengantar-partner");
  const acct = await import("@tokophi/db/mengantar-account");
  const lib = await import("@tokophi/lib/mengantar");
  const ship = await import("../apps/admin/lib/mengantar-shipping");
  const trk = await import("../apps/admin/lib/mengantar-tracking");

  const cfg = (await getProviderConfig()).mengantar;
  say("config", { env: cfg.env, partnerOrigin: cfg.partnerBase, partnerId: cfg.partnerId, partnerSource: cfg.source, check: CHECK });
  if (cfg.env !== "sandbox" || !cfg.partnerBase) refuse("resolved Mengantar config is not the sandbox");
  if (PHONE && !partnerPhone(PHONE)) refuse("--phone must be an Indonesian mobile number (08…/62…)");

  // ── Test store (idempotent by slug) ─────────────────────────────────────────────────────────
  const slug = `mg-sbx-${TAG}`;
  const ORIGIN_DISTRICT = 2103; // Cilandak, Jakarta Selatan (sandbox couriers want a Jakarta pickup)
  const DEST_DISTRICT = 2105; // Kebayoran Baru, Jakarta Selatan
  const area = async (d: number) =>
    (await db.select({ a: schema.kiriminajaAreas.mengantarAreaId }).from(schema.kiriminajaAreas).where(eq(schema.kiriminajaAreas.id, d)).limit(1))[0]?.a ?? null;
  const originArea = await area(ORIGIN_DISTRICT);
  const destArea = await area(DEST_DISTRICT);
  if (!originArea || !destArea) refuse("the Jakarta Selatan area bridges are not loaded (run load:mengantar-areas)");
  let [store] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.slug, slug)).limit(1);
  if (!store) {
    store = await db.transaction(async (tx) => {
      const [acc] = await tx.insert(schema.accounts).values({ name: `Mengantar sandbox ${TAG}` }).returning();
      const [u] = await tx.insert(schema.users).values({ email: EMAIL!, name: "Pemilik Uji Sandbox" }).returning();
      const [st] = await tx.insert(schema.stores).values({ accountId: acc.id, name: `Toko Uji Mengantar ${TAG}`, slug, status: "active", approvedAt: new Date() }).returning({ id: schema.stores.id });
      await tx.insert(schema.storeUsers).values({ storeId: st.id, userId: u.id, role: "owner", acceptedAt: new Date() });
      await tx.insert(schema.storeSettings).values({
        storeId: st.id,
        senderName: "Gudang Uji Sandbox",
        senderPhone: partnerPhone(PHONE ?? "") ?? "081200000000",
        senderAddress: "Jl. Uji Sandbox No. 1, RT 01/RW 01",
        senderKecamatanId: ORIGIN_DISTRICT,
        senderKecamatanName: "Cilandak",
        senderMengantarAreaId: originArea,
      });
      return st;
    });
  }
  const storeId = store.id;
  const ext = mengantarExternalUserId(storeId, "sandbox");
  say("store", { storeId, slug, ext });
  if (CHECK) {
    say("check", { ok: true, note: "no network call made; re-run with --confirm-sandbox" });
    await client.end();
    return;
  }

  // ── 1–3 Partner ─────────────────────────────────────────────────────────────────────────────
  const l1 = await partnerListSellers({ externalUserId: ext }, { cfg });
  say("1 list", l1.ok ? { ok: true, total: l1.data.total, sellers: l1.data.sellers.map((s) => ({ sellerId: s.sellerId, active: s.active })) } : { ok: false, code: l1.code, http: l1.httpStatus, unknown: l1.unknown });
  const c = await acct.connectStoreMengantar(storeId, { source: "operator" });
  const st1 = await acct.mengantarAccountStatus(storeId);
  say("2 connect", { state: c.state, sellerId: st1.sellerId, keyHint: st1.keyHint, lastErrorCode: st1.lastErrorCode });
  if (c.state !== "connected") {
    await client.end();
    refuse(`not connected (${c.state}) — see lastErrorCode above`);
  }
  const who = (await db.select({ phone: schema.storeSettings.senderPhone }).from(schema.storeSettings).where(eq(schema.storeSettings.storeId, storeId)).limit(1))[0];
  const again = await partnerRegisterSeller({ name: `Toko Uji Mengantar ${TAG}`, email: EMAIL!, phone: who?.phone ?? "", externalUserId: ext }, { cfg });
  say("3 register again", again.ok ? { ok: true, http: again.httpStatus, alreadyRegistered: again.data.alreadyRegistered, sameSeller: again.data.sellerId === st1.sellerId, keyReturned: !!again.data.apiKey } : { ok: false, code: again.code, http: again.httpStatus });

  const open = await acct.openStoreMengantar(storeId);
  if (!open.ok) refuse(`opener refused: ${open.reason}`);
  const call = { cfg: open.cfg };

  // ── 4–5 Public with the store key ───────────────────────────────────────────────────────────
  const s4 = await lib.mgSearchArea("kebayoran baru", call);
  say("4 area search", s4.ok ? { ok: true, rows: s4.data.length, firstIdIs24hex: /^[0-9a-f]{24}$/.test(s4.data[0]?.id ?? "") } : { ok: false, http: s4.httpStatus });
  const s5 = await lib.mgPickupSlots("x".repeat(24), call).catch((e: Error) => ({ ok: false as const, error: e.name, httpStatus: -1 }));
  say("5 GET /time", s5.ok ? { ok: true, slots: s5.data.length } : { ok: false, http: s5.httpStatus });

  // ── 6–8 Order, rates, drop-off booking, cancel ──────────────────────────────────────────────
  async function newOrder(n: number) {
    const number = `MGSBX-${TAG}-${Date.now().toString(36)}-${n}`;
    const [o] = await db
      .insert(schema.orders)
      .values({
        storeId,
        number,
        status: "baru",
        subtotalIdr: 150000,
        shippingIdr: 10000,
        totalIdr: 160000,
        courier: "jnt",
        serviceType: "JT",
        shippingProvider: "mengantar",
        shipRecipient: "Penerima Uji",
        shipPhone: "081200000001",
        shipAddress: "Jl. Tujuan Uji No. 2",
        shipDistrictId: DEST_DISTRICT,
        shipMengantarAreaId: destArea,
        city: "Jakarta Selatan",
      })
      .returning({ id: schema.orders.id });
    await db.insert(schema.orderLineItems).values({ orderId: o.id, title: "Barang uji sandbox", qty: 1, priceIdr: 150000, totalIdr: 150000 });
    await db.insert(schema.payments).values({ orderId: o.id, storeId, method: "transfer", amountIdr: 160000, status: "berhasil", paidAt: new Date() });
    return { id: o.id, number };
  }
  const o1 = await newOrder(1);
  const rates = await ship.mengantarOrderRates(storeId, o1.number);
  say("6 rates", rates.ok ? { ok: true, rates: rates.rates.map((r) => `${r.code}:${r.type}:${r.cost}`) } : { ok: false, error: rates.error });
  const jt = rates.rates.find((r) => r.type === "JT");
  if (!jt) {
    await client.end();
    refuse("no JT rate — cannot book the drop-off proof");
  }
  const ledgerBefore = await db.execute(sql`select count(*)::int as n from ledger_entries where store_id = ${storeId}`);
  const b1 = await ship.bookMengantar(storeId, { orderNumber: o1.number, service: jt.code, serviceType: jt.type }, { pickupMode: "dropOff" });
  const [r1] = await db
    .select({ mgEnv: schema.orders.mgEnv, mgSellerId: schema.orders.mgSellerId, mgOrderId: schema.orders.mgOrderId, mgOrderCode: schema.orders.mgOrderCode, mgIsPaid: schema.orders.mgIsPaid, awb: schema.orders.awb, status: schema.orders.status })
    .from(schema.orders)
    .where(eq(schema.orders.id, o1.id));
  const ledgerAfter = await db.execute(sql`select count(*)::int as n from ledger_entries where store_id = ${storeId}`);
  say("7 book JT drop-off", { ok: b1.ok, error: b1.ok ? undefined : b1.error, ...r1, sameSeller: r1.mgSellerId === open.sellerId, ledgerRowsAdded: Number((ledgerAfter as unknown as { n: number }[])[0].n) - Number((ledgerBefore as unknown as { n: number }[])[0].n) });
  if (b1.ok) {
    const cx = await ship.cancelMengantar(storeId, o1.number);
    say("8 cancel", cx);
    if (r1.mgOrderCode) {
      const back = await lib.mgTrackByOrderId(r1.mgOrderCode, call).catch((e: Error) => ({ ok: false as const, error: e.name, httpStatus: -1 }));
      say("8b read-back after cancel", back.ok ? { ok: true, found: !!back.data, outcome: back.data?.outcome ?? null, flags: back.data?.flags ?? [] } : { ok: false, http: back.httpStatus });
    }
  }

  // ── 9 Second booking + simulation + sweep ───────────────────────────────────────────────────
  const o2 = await newOrder(2);
  const b2 = await ship.bookMengantar(storeId, { orderNumber: o2.number, service: jt.code, serviceType: jt.type }, { pickupMode: "dropOff" });
  say("9 book #2", { ok: b2.ok, error: b2.ok ? undefined : b2.error });
  const [r2] = await db.select({ code: schema.orders.mgOrderCode, courier: schema.orders.mgCourier }).from(schema.orders).where(eq(schema.orders.id, o2.id));
  if (b2.ok && r2.code && r2.courier) {
    for (const target of ["ON DELIVERY", "DELIVERED"] as const) {
      const sim = await lib.mgSimulate({ courier: r2.courier, orderId: r2.code, statusCategory: target }, call);
      const sweep = await trk.sweepMengantarTracking();
      const [now] = await db.select({ status: schema.orders.status, awb: schema.orders.awb }).from(schema.orders).where(eq(schema.orders.id, o2.id));
      say(`9 simulate ${target}`, { simOk: sim.ok, simStatus: sim.ok ? sim.data.statusCategory : sim.httpStatus, sweep: { scanned: sweep.scanned, advanced: sweep.advanced, accountMissing: sweep.accountMissing, errors: sweep.errors }, order: now });
    }
  }

  // ── 10 Negative: cross-env order ────────────────────────────────────────────────────────────
  const neg = await acct.openStoreMengantar(storeId, { mgEnv: "production", mgSellerId: open.sellerId });
  say("10 env isolation", { refused: !neg.ok, reason: neg.ok ? null : neg.reason });

  await client.end();
}

main().catch((e) => {
  console.error("mengantar-sandbox-e2e failed:", e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
