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
  const [store] = await client<{ id: string; name: string }[]>`SELECT id, name FROM stores LIMIT 1`;
  const [{ count: ownerCount }] = await client<{ count: number }[]>`SELECT count(*)::int AS count FROM products`;
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
