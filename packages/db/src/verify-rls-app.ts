import { withTenant } from "./rls";
import { schema, client } from "./client";
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
  // ⚠️ This was `.from(stores).limit(1)` — the SAME arbitrary-row fixture that kept `verify-rls`
  // red for weeks (its note says so in full), left uncorrected in this file because the fix was
  // applied to the instance rather than to the class. `LIMIT 1` with no ORDER BY returns whatever
  // Postgres reaches first, and the seed has SEVEN stores, six of them with no products — so
  // `own > 0` below was one plan change away from failing on a codebase with nothing wrong with it.
  // Now that CI runs this, a fixture that picks a different row on a different day is not a nuisance,
  // it is the thing that teaches people to ignore the check. Same deterministic pick as verify-rls:
  // the store with the most products, ties broken by slug.
  const [store] = await client<{ id: string; name: string }[]>`
    SELECT s.id, s.name
    FROM stores s
    JOIN products p ON p.store_id = s.id
    GROUP BY s.id, s.name, s.slug
    ORDER BY count(p.id) DESC, s.slug
    LIMIT 1`;
  if (!store) throw new Error("No store with products — seed first (npm run seed -w @tokophi/db).");
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

  // Support tickets (RLS retrofitted in 0035) — the admin's Bantuan path: createTicket
  // inserts a ticket + its first message under withTenant, and a foreign tenant sees neither.
  const ticketId = await withTenant(store.id, async (tx) => {
    const [t] = await tx.insert(schema.supportTickets).values({ storeId: store.id, subject: TAG, status: "open" }).returning();
    await tx.insert(schema.supportMessages).values({ ticketId: t.id, storeId: store.id, sender: "merchant", body: TAG });
    return t.id;
  });
  const ownTicket = await withTenant(store.id, async (tx) =>
    (await tx.select({ id: schema.supportTickets.id }).from(schema.supportTickets).where(eq(schema.supportTickets.id, ticketId))).length,
  );
  assert(`support: own tenant reads back its ticket (${ownTicket})`, ownTicket === 1);
  const foreignTicket = await withTenant(NIL, async (tx) =>
    (await tx.select({ id: schema.supportTickets.id }).from(schema.supportTickets).where(eq(schema.supportTickets.id, ticketId))).length +
    (await tx.select({ id: schema.supportMessages.id }).from(schema.supportMessages).where(eq(schema.supportMessages.ticketId, ticketId))).length,
  );
  assert(`support: foreign tenant sees neither ticket nor messages (${foreignTicket})`, foreignTicket === 0);
  await withTenant(store.id, async (tx) => {
    await tx.delete(schema.supportMessages).where(eq(schema.supportMessages.ticketId, ticketId));
    await tx.delete(schema.supportTickets).where(eq(schema.supportTickets.id, ticketId));
  });
  const afterTicket = await withTenant(store.id, async (tx) =>
    (await tx.select({ id: schema.supportTickets.id }).from(schema.supportTickets).where(eq(schema.supportTickets.id, ticketId))).length,
  );
  assert(`support: cleanup (${afterTicket})`, afterTicket === 0);

  await client.end();
  console.log(`\n${process.exitCode ? "APP-PATH RLS FAILED" : "App-path RLS (withTenant) verified ✅"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
