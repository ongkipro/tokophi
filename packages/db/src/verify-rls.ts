import { client } from "./client";

// Proves that the RLS policies from migration 0012 actually isolate tenants.
// The app currently connects as the table OWNER (which bypasses RLS), so to see
// enforcement we `SET LOCAL ROLE indostore_app` (the non-owner app role) inside a
// transaction and toggle the `app.store_id` GUC. Run: npm run verify-rls -w @indostore/db
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
    await tx`SET LOCAL ROLE indostore_app`;
    const [{ count }] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM products`;
    return count;
  });
  assert(`tenant sees its own products (${seen} == ${ownerCount})`, seen === ownerCount && seen > 0);

  // 2. Wrong tenant → sees nothing.
  const other = await client.begin(async (tx) => {
    await tx`SELECT set_config('app.store_id', ${RANDOM_UUID}, true)`;
    await tx`SET LOCAL ROLE indostore_app`;
    const [{ count }] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM products`;
    return count;
  });
  assert(`other tenant sees 0 products (got ${other})`, other === 0);

  // 3. No GUC set → sees nothing (fail-closed).
  const noguc = await client.begin(async (tx) => {
    await tx`SET LOCAL ROLE indostore_app`;
    const [{ count }] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM customers`;
    return count;
  });
  assert(`missing app.store_id → 0 rows (got ${noguc})`, noguc === 0);

  // 4. WITH CHECK blocks cross-tenant writes.
  let blocked = false;
  try {
    await client.begin(async (tx) => {
      await tx`SELECT set_config('app.store_id', ${store.id}, true)`;
      await tx`SET LOCAL ROLE indostore_app`;
      // Insert a discount for a DIFFERENT store than the GUC → must violate WITH CHECK.
      await tx`INSERT INTO discounts (store_id, code, kind, value) VALUES (${RANDOM_UUID}, 'RLSHACK', 'nominal', 1)`;
    });
  } catch {
    blocked = true;
  }
  assert("WITH CHECK blocks writing another store's row", blocked);

  await client.end();
  console.log(`\n${process.exitCode ? "RLS VERIFY FAILED" : "RLS verified ✅"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
