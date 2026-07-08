import { withTenant } from "./rls";
import { db, schema, client } from "./client";
import { eq } from "drizzle-orm";

// Verifies the ACTUAL runtime path the admin now uses: every read/write goes through
// withTenant() (sets app.store_id + SET LOCAL ROLE tokophi_app), so RLS enforces.
// This proves reads work, writes work (happy path), and tenant isolation holds — all
// through the non-owner role, exactly as the app will on the VPS.
const NIL = "00000000-0000-0000-0000-000000000000";
const TAG = "RLSAPPTEST";

function assert(label: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) process.exitCode = 1;
}

async function count(storeId: string, table: "products" | "discounts", code?: string) {
  return withTenant(storeId, async (tx) => {
    if (table === "products") {
      const rows = await tx.select({ id: schema.products.id }).from(schema.products);
      return rows.length;
    }
    const rows = await tx.select({ id: schema.discounts.id }).from(schema.discounts).where(code ? eq(schema.discounts.code, code) : undefined);
    return rows.length;
  });
}

async function main() {
  const [store] = await db.select({ id: schema.stores.id, name: schema.stores.name }).from(schema.stores).limit(1);
  console.log(`store = ${store.name} (${store.id})\n`);

  // READS under the restricted role via withTenant.
  const own = await count(store.id, "products");
  assert(`read: own tenant sees its products (${own} > 0)`, own > 0);
  const foreign = await count(NIL, "products");
  assert(`read: foreign tenant sees 0 products (${foreign})`, foreign === 0);

  // WRITE happy path: tokophi_app inserts a row for its OWN store (WITH CHECK passes).
  await withTenant(store.id, (tx) =>
    tx.insert(schema.discounts).values({ storeId: store.id, code: TAG, kind: "nominal", value: 1 }),
  );
  const seen = await count(store.id, "discounts", TAG);
  assert(`write: own tenant persisted + reads back its discount (${seen})`, seen === 1);

  // Isolation: a foreign tenant can't see the freshly-written row.
  const hidden = await count(NIL, "discounts", TAG);
  assert(`write: foreign tenant can't see it (${hidden})`, hidden === 0);

  // Cleanup (own tenant deletes its own row).
  await withTenant(store.id, (tx) => tx.delete(schema.discounts).where(eq(schema.discounts.code, TAG)));
  const after = await count(store.id, "discounts", TAG);
  assert(`cleanup: row removed (${after})`, after === 0);

  await client.end();
  console.log(`\n${process.exitCode ? "APP-PATH RLS FAILED" : "App-path RLS (withTenant) verified ✅"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
