import { client } from "./client";

// Proves that the RLS policies from migration 0012 actually isolate tenants.
// The app currently connects as the table OWNER (which bypasses RLS), so to see
// enforcement we `SET LOCAL ROLE tokophi_app` (the non-owner app role) inside a
// transaction and toggle the `app.store_id` GUC. Run: npm run verify-rls -w @tokophi/db
const RANDOM_UUID = "00000000-0000-4000-8000-000000000000";

function assert(label: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  // Ground truth as owner (RLS bypassed): the real store + its product count.
  // The fixture must be the store that actually HAS data, chosen deterministically.
  //
  // ⚠️ This was `SELECT id, name FROM stores LIMIT 1` — the very bug this file exists to catch. Once
  // the seed grew past one store, `LIMIT 1` started returning an arbitrary row (kopi-senja, 0
  // products), so the checks compared an EMPTY store's rows against the global totals and failed
  // forever. "RLS VERIFY FAILED" became background noise — and an alarm that is always on is an alarm
  // that is off. Both cross-tenant leaks fixed in 0058 shipped past a verifier that was already red.
  const [store] = await client<{ id: string; name: string; slug: string }[]>`
    SELECT s.id, s.name, s.slug
    FROM stores s
    JOIN products p ON p.store_id = s.id
    GROUP BY s.id, s.name, s.slug
    ORDER BY count(p.id) DESC, s.slug
    LIMIT 1`;
  if (!store) throw new Error("No store with products — seed first (npm run seed -w @tokophi/db).");
  // Ground truth for THIS store, not the whole table: with several stores seeded, a global count would
  // be comparing a tenant's rows against everybody's.
  const [{ count: ownerCount }] = await client<{ count: number }[]>`
    SELECT count(*)::int AS count FROM products WHERE store_id = ${store.id}`;
  console.log(`store = ${store.name} (${store.id}) · products (owner view) = ${ownerCount}\n`);

  // 1. Correct tenant → sees all its rows.
  const seen = await client.begin(async (tx) => {
    await tx`SELECT set_config('app.store_id', ${store.id}, true)`;
    await tx`SET LOCAL ROLE tokophi_app`;
    const [{ count }] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM products`;
    return count;
  });
  assert(`tenant sees its own products (${seen} == ${ownerCount})`, seen === ownerCount && seen > 0);

  // 2. Wrong tenant → sees nothing.
  const other = await client.begin(async (tx) => {
    await tx`SELECT set_config('app.store_id', ${RANDOM_UUID}, true)`;
    await tx`SET LOCAL ROLE tokophi_app`;
    const [{ count }] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM products`;
    return count;
  });
  assert(`other tenant sees 0 products (got ${other})`, other === 0);

  // 3. No GUC set → sees nothing (fail-closed).
  const noguc = await client.begin(async (tx) => {
    await tx`SET LOCAL ROLE tokophi_app`;
    const [{ count }] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM customers`;
    return count;
  });
  assert(`missing app.store_id → 0 rows (got ${noguc})`, noguc === 0);

  // 4. WITH CHECK blocks cross-tenant writes.
  let blocked = false;
  try {
    await client.begin(async (tx) => {
      await tx`SELECT set_config('app.store_id', ${store.id}, true)`;
      await tx`SET LOCAL ROLE tokophi_app`;
      // Insert a discount for a DIFFERENT store than the GUC → must violate WITH CHECK.
      await tx`INSERT INTO discounts (store_id, code, kind, value) VALUES (${RANDOM_UUID}, 'RLSHACK', 'nominal', 1)`;
    });
  } catch {
    blocked = true;
  }
  assert("WITH CHECK blocks writing another store's row", blocked);

  // 5. Coverage: EVERY store-scoped table (i.e. every table with a store_id column) must
  //    have RLS enabled. This is the "table list", derived from the catalog so it can't
  //    drift: adding a store-scoped table without RLS (as 0030 did for support_*) fails here.
  const gaps = await client<{ relname: string }[]>`
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'store_id' AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    ORDER BY 1`;
  const [{ count: scoped }] = await client<{ count: number }[]>`
    SELECT count(*)::int AS count FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'store_id' AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind = 'r'`;
  // `platform_activity` is the ONE deliberate exception: it is the platform's own audit log, read
  // cross-tenant by the super-admin and written before a session exists (signup/provisioning), so
  // it is owner-only by design — not merchant data.
  // `media` + `payments` were retrofitted in 0036 and are now enforced like everything else.
  // Everything else with a store_id MUST have RLS.
  const KNOWN_EXCEPTIONS = ["platform_activity"];
  const unexpected = gaps.map((g) => g.relname).filter((t) => !KNOWN_EXCEPTIONS.includes(t));
  assert(
    `store-scoped tables with RLS: ${scoped - gaps.length}/${scoped}` +
      (unexpected.length ? ` — MISSING RLS: ${unexpected.join(", ")}` : ` (known exceptions: ${KNOWN_EXCEPTIONS.join(", ")})`),
    unexpected.length === 0,
  );

  // 5b. `stores` — THE BLIND SPOT. Check 5 above derives its table list from the catalog by looking
  //     for a `store_id` column, so it can never see `stores`: that table is keyed by `id`. The one
  //     table that IDENTIFIES the tenant was invisible to the check built to protect tenants, and two
  //     cross-tenant leaks shipped green through it (getStoreProfile + getBilling both did
  //     `.from(stores).limit(1)` inside withCurrentTenant and got an ARBITRARY store — a merchant read
  //     a stranger's shop name, WhatsApp and billing countdown). Fixed by 0058 + explicit WHEREs.
  //
  //     Asserted here explicitly, because a rule with no test is a rule that comes back.
  const [{ rls: storesRls }] = await client<{ rls: boolean }[]>`
    SELECT relrowsecurity AS rls FROM pg_class WHERE relname = 'stores' AND relkind = 'r'`;
  assert("stores has RLS (0058 — keyed by id, so check 5 cannot see it)", storesRls);

  const storesSeen = await client.begin(async (tx) => {
    await tx`SELECT set_config('app.store_id', ${store.id}, true)`;
    await tx`SET LOCAL ROLE tokophi_app`;
    const rows = await tx<{ slug: string }[]>`SELECT slug FROM stores`;
    return rows.map((r) => r.slug);
  });
  assert(
    `tenant sees ONLY its own store row (got ${storesSeen.length}: ${storesSeen.join(",") || "-"})`,
    storesSeen.length === 1 && storesSeen[0] === store.slug,
  );

  // Fails closed with no GUC — the same rule every other table follows.
  const storesNoGuc = await client.begin(async (tx) => {
    await tx`SET LOCAL ROLE tokophi_app`;
    const [{ count }] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM stores`;
    return count;
  });
  assert(`stores: missing app.store_id → 0 rows (got ${storesNoGuc})`, storesNoGuc === 0);

  // The OWNER must still see every store, or the things that legitimately span tenants break:
  // slug uniqueness at signup (two shops would collide on one subdomain) and the billing cron
  // (scoping it to one store silently stops billing everyone else). No table here uses FORCE ROW
  // LEVEL SECURITY, which is exactly what keeps that true — assert it rather than trust it.
  const [{ count: ownerSees }] = await client<{ count: number }[]>`SELECT count(*)::int AS count FROM stores`;
  assert(`owner still sees all stores (${ownerSees}) — provision/cron depend on it`, ownerSees > 1);

  // 5c. THE CHILD-TABLE BLIND SPOT — the class this verifier structurally cannot police.
  //
  //     Check 5 derives its table list from tables that HAVE a `store_id` column. A table without one
  //     is therefore invisible to it — and those tables are not safe, they are simply unreachable by
  //     this check. They carry no RLS, `tokophi_app` holds full DML on them, and their ONLY tenant
  //     boundary is the application reading their RLS-protected parent first (AGENTS.md, "THE
  //     CHILD-TABLE RULE"). That rule has been broken SEVEN times and shipped every time: e61df25
  //     fixed three call sites, and auditing the class on 2026-07-20 found four more —
  //     media.ts/product_media, deleteDiscount, createPurchaseOrder, syncChildren. One of them
  //     (deleteDiscount) was a live cross-tenant DELETE, harmless only because the table was empty.
  //
  //     We cannot assert an app-layer guard from SQL. What we CAN do is refuse to let this class grow
  //     silently: every un-RLS'd, store-scoped child table must be on the reviewed list below. A NEW
  //     one appearing means somebody added a table whose writers nobody has audited — which is exactly
  //     how all seven got in. Adding a name here is cheap; it is meant to force the reading of the rule.
  const REVIEWED_CHILD_TABLES = [
    "collection_conditions", "collection_products", "customer_addresses", "discount_usages",
    "fulfillments", "inventory_levels", "menu_items", "order_line_items", "product_media",
    "product_options", "purchase_order_items",
    // flash_sale_items (0076): child of flash_sales; every write in lib/actions/flash.ts writeItems()
    // proves the parent sale AND each product_id belong to the tenant (RLS'd reads) before insert.
    "flash_sale_items",
  ];
  // Platform/global tables: no tenant to scope to, absence of store_id is correct by design.
  const GLOBAL_TABLES = [
    "plans", "platform_admins", "platform_cod", "platform_couriers", "platform_payment_channels",
    "platform_payment_gateways", "platform_payout", "shipping_aggregator", "kiriminaja_areas",
    "kelurahan", "accounts", "users", "stores",
    // Google Product Taxonomy (0072, ADR 0011): global reference data, same class as kiriminaja_areas.
    "product_taxonomy",
  ];
  const noStoreId = await client<{ relname: string }[]>`
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND NOT c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'store_id' AND a.attnum > 0 AND NOT a.attisdropped
      )
    ORDER BY 1`;
  const unreviewed = noStoreId
    .map((t) => t.relname)
    .filter((t) => !REVIEWED_CHILD_TABLES.includes(t) && !GLOBAL_TABLES.includes(t) && !t.startsWith("__drizzle"));
  assert(
    unreviewed.length
      ? `UNREVIEWED table with no store_id and no RLS: ${unreviewed.join(", ")} — audit every writer ` +
        `against AGENTS.md "THE CHILD-TABLE RULE", then add it to REVIEWED_CHILD_TABLES or GLOBAL_TABLES`
      : `child-table blind spot: ${REVIEWED_CHILD_TABLES.length} un-RLS'd child tables, all reviewed ` +
        `(their ONLY boundary is the app reading the parent under RLS — this check cannot prove that)`,
    unreviewed.length === 0,
  );

  // 6. support_tickets / support_messages (RLS retrofitted in 0035) isolate like the rest.
  const [{ count: ticketsOwner }] = await client<{ count: number }[]>`SELECT count(*)::int AS count FROM support_tickets WHERE store_id = ${store.id}`;
  const support = await client.begin(async (tx) => {
    await tx`SELECT set_config('app.store_id', ${store.id}, true)`;
    await tx`SET LOCAL ROLE tokophi_app`;
    const [{ count: own }] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM support_tickets`;
    const [{ count: msgs }] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM support_messages`;
    return { own, msgs };
  });
  assert(`tenant sees its own support_tickets (${support.own} == ${ticketsOwner})`, support.own === ticketsOwner && support.own > 0);
  const supportOther = await client.begin(async (tx) => {
    await tx`SELECT set_config('app.store_id', ${RANDOM_UUID}, true)`;
    await tx`SET LOCAL ROLE tokophi_app`;
    const [{ count: t }] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM support_tickets`;
    const [{ count: m }] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM support_messages`;
    return t + m;
  });
  assert(`other tenant sees 0 support tickets/messages (got ${supportOther})`, supportOther === 0);

  await client.end();
  console.log(`\n${process.exitCode ? "RLS VERIFY FAILED" : "RLS verified ✅"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
