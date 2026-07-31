"use server";
import { schema } from "@tokophi/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { defaultInventoryLevelId } from "@/lib/inventory-location";

function revalidate() {
  revalidatePath("/produk/pembelian");
  revalidatePath("/produk/inventori");
  revalidatePath("/produk");
}

export type POLine = { variantId: string; qty: number; cost: number };

export async function createPurchaseOrder(input: {
  supplier: string;
  etaDate?: string;
  note?: string;
  lines: POLine[];
}): Promise<string> {
  const { storeId: sid } = await requireCapability("purchases:write");
  const lines = input.lines.filter((l) => l.variantId && l.qty > 0);
  if (!lines.length) throw new Error("no lines");
  // ⚠️ NOT `Date.now().toString().slice(-6)`. Six digits of epoch-ms REPEAT every 10^6 ms ≈ 16.7
  // minutes, so two POs at the same point in that cycle got the same code — and while the constraint
  // was platform-wide, the second one FAILED TO SAVE for a merchant who had done nothing wrong.
  // 0084 scoped the constraint per store, which removes the cross-tenant half; this removes the rest.
  // Full millis + 4 random digits: monotonic, readable, and collision-free in practice.
  const code = `PO-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 9000 + 1000)}`;
  await withTenant(sid, async (db) => {
    // match supplier by name (case-insensitive); nullable if not found
    const sups = await db.select({ id: schema.suppliers.id, name: schema.suppliers.name }).from(schema.suppliers).where(eq(schema.suppliers.storeId, sid));
    const supplierId = sups.find((s) => s.name.toLowerCase() === input.supplier.trim().toLowerCase())?.id ?? null;
    const total = lines.reduce((a, l) => a + l.qty * l.cost, 0);
    const [po] = await db
      .insert(schema.purchaseOrders)
      .values({ storeId: sid, supplierId, code, status: "dipesan", totalIdr: total, etaDate: input.etaDate || null, note: input.note || null })
      .returning();
    // `l.variantId` is CLIENT INPUT and `purchase_order_items` has no store_id / no RLS, so nothing
    // downstream re-checks it. Read the variants back under RLS (`product_variants` IS policed) and
    // keep only ours: a foreign id here writes an FK to another store's variant, and "Terima barang"
    // would then add stock to THEIR shelf. Unknown ids become null rather than failing the whole PO —
    // a line can legitimately be free-text (no variant), which is why the column is nullable.
    const wanted = [...new Set(lines.map((l) => l.variantId).filter(Boolean))] as string[];
    const ours = wanted.length
      ? new Set((await db.select({ id: schema.productVariants.id }).from(schema.productVariants).where(inArray(schema.productVariants.id, wanted))).map((v) => v.id))
      : new Set<string>();
    await db.insert(schema.purchaseOrderItems).values(
      lines.map((l) => ({ purchaseOrderId: po.id, variantId: l.variantId && ours.has(l.variantId) ? l.variantId : null, qty: l.qty, costIdr: l.cost, receivedQty: 0 })),
    );
  });
  revalidate();
  return code;
}

// Receive the goods: bump inventory by the outstanding qty of each line, mark received.
export async function receivePurchaseOrder(code: string): Promise<void> {
  const { storeId: sid } = await requireCapability("purchases:write");
  await withTenant(sid, async (db) => {
    const [po] = await db.select({ id: schema.purchaseOrders.id, status: schema.purchaseOrders.status }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.code, code)).limit(1);
    if (!po || po.status === "diterima") return;
    const items = await db.select().from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.purchaseOrderId, po.id));
    for (const it of items) {
      const add = it.qty - it.receivedQty;
      if (it.variantId && add > 0) {
        // WHICH row (and whose store) — `lib/inventory-location.ts`, the one copy of this expression.
        // It carries both reasons this is not a plain `where variant_id = …`: the default location (an
        // unordered limit(1) lands the receipt in an ARBITRARY warehouse), and the `locations` join as
        // THE TENANT BOUNDARY (a PO line carrying another store's variantId would add stock to THEIR
        // shelf). createPurchaseOrder filters variantIds too — belt AND braces.
        //
        // It deliberately does NOT read `available`. It used to: `set({ available: inv.available + add })`
        // was a read-then-write with no lock, so a sale that decremented between the read and the write
        // — or a second receipt — was silently overwritten by a stale absolute value (same
        // last-write-wins class as bc2ebfd in the bulk editor). The UPDATE below is RELATIVE, evaluated
        // by Postgres against the row's current value under the update's own row lock, so it needs no
        // FOR UPDATE and cannot lose a concurrent write.
        const invId = await defaultInventoryLevelId(db, it.variantId, sid);
        if (invId)
          await db
            .update(schema.inventoryLevels)
            .set({ available: sql`${schema.inventoryLevels.available} + ${add}` })
            .where(eq(schema.inventoryLevels.id, invId));
      }
      await db.update(schema.purchaseOrderItems).set({ receivedQty: it.qty }).where(eq(schema.purchaseOrderItems.id, it.id));
    }
    await db.update(schema.purchaseOrders).set({ status: "diterima" }).where(eq(schema.purchaseOrders.id, po.id));
  });
  revalidate();
}

// ── Undo a receipt booked by mistake ──────────────────────────────────────────────────────────────
// Subtract exactly what the receipt added, clear `received_qty`, put the PO back to `dipesan`.
//
// WHY THIS SHAPE and not "leave the PO received + book a compensating stock adjustment": there is no
// stock-movement ledger in this schema to book it INTO. `ledger_entries` is the MONEY book (sale /
// retur / payout / adjustment, signed IDR, feeds payouts) — it has no variant and no qty. Stock here
// is a single mutable `inventory_levels.available` per (variant, location); every writer (the order
// path, `updateStock`, `receivePurchaseOrder`) states current stock, never a movement. A compensating
// entry needs a table, a migration and a schema change — and `packages/db/src/schema.ts` is being
// edited by another agent right now. Inventing half a ledger (one row type, written by one caller,
// read by nobody, reconciling against nothing) is worse than no ledger: it would LOOK like an audit
// trail while the receipt it "compensates" is still the only thing any report actually reads.
// So the honest move in THIS codebase is to reverse the state transition that made the mistake, and
// leave it reversible: "Tandai diterima" re-applies it. `received_qty` is state, not history — the
// receipt trail this fix was told not to erase does not exist yet either way.
//
// Returns which variants the subtraction drove below zero so the UI can SAY SO. It does not clamp:
// if the phantom stock was already sold, negative is the true figure (units owed), and flooring it at
// 0 is exactly how the order path used to make an oversell indistinguishable from an honest sell-out.
export async function unreceivePurchaseOrder(
  code: string,
): Promise<{ ok: true; negatives: { title: string; available: number }[] } | { ok: false; error: string }> {
  const { storeId: sid } = await requireCapability("purchases:write");
  const res = await withTenant(sid, async (db) => {
    // ⚠️ THE GUARD, and it is the FIRST statement on purpose: a compare-and-swap, not a read-then-
    // check. `receivePurchaseOrder`'s `if (po.status === "diterima") return` is a read followed by a
    // write, so two concurrent calls can both read the old status and both act — harmless there
    // (receive is naturally idempotent: `add = qty - receivedQty` is 0 the second time), but here a
    // double-undo would subtract the stock TWICE. This UPDATE …WHERE status='diterima' claims the row
    // under Postgres' own row lock: exactly one caller gets a row back, the loser gets zero and has
    // written nothing. It is also the RLS-verified read of the parent id that the CHILD-TABLE RULE
    // requires before touching `purchase_order_items` / `inventory_levels` (neither has a store_id) —
    // `purchase_orders` IS policed, so a foreign code claims nothing and we bail below.
    const claimed = await db
      .update(schema.purchaseOrders)
      .set({ status: "dipesan" })
      .where(and(eq(schema.purchaseOrders.code, code), eq(schema.purchaseOrders.status, "diterima")))
      .returning({ id: schema.purchaseOrders.id });
    if (!claimed.length) return { ok: false as const, error: "Pesanan ini tidak berstatus diterima — tidak ada penerimaan untuk dibatalkan." };
    const poId = claimed[0].id;

    const items = await db.select().from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.purchaseOrderId, poId));
    const negatives: { title: string; available: number }[] = [];
    for (const it of items) {
      // `receivedQty` — what the receipt ACTUALLY added — not `qty`. They are equal after a full
      // receive, but a partial one (`sebagian`) added only the delta, and subtracting `qty` there
      // would invent stock removal that never happened.
      const back = it.receivedQty;
      if (it.variantId && back > 0) {
        // Same row-resolution as receivePurchaseOrder, from the same helper and for the same two
        // reasons: the default location, and the `locations` join as THE TENANT BOUNDARY — a line
        // carrying another store's variantId would subtract from THEIR shelf. See
        // `lib/inventory-location.ts`; it deliberately does NOT read `available` (see the UPDATE below).
        const invId = await defaultInventoryLevelId(db, it.variantId, sid);
        if (invId) {
          // RELATIVE, evaluated by Postgres against the row's current value under the update's own
          // row lock — never `set({ available: read - back })`, which is the last-write-wins bug
          // bc2ebfd/80fb83b closed elsewhere: a sale landing between the read and the write would be
          // silently overwritten by a stale absolute. No GREATEST clamp, on purpose (see the header).
          // `returning` reads the value AFTER the write, so it reports rather than decides.
          const [row] = await db
            .update(schema.inventoryLevels)
            .set({ available: sql`${schema.inventoryLevels.available} - ${back}` })
            .where(eq(schema.inventoryLevels.id, invId))
            .returning({ available: schema.inventoryLevels.available });
          // The product title is only ever READ on this branch (the warning list), so it is fetched
          // here rather than joined into every row resolution — a negative is the exception, not the
          // path. Two extra joins on every PO line to label a case that usually does not happen.
          if (row && row.available < 0) {
            const [p] = await db
              .select({ title: schema.products.title })
              .from(schema.productVariants)
              .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
              .where(eq(schema.productVariants.id, it.variantId))
              .limit(1);
            negatives.push({ title: p?.title ?? "Produk", available: row.available });
          }
        }
      }
      await db.update(schema.purchaseOrderItems).set({ receivedQty: 0 }).where(eq(schema.purchaseOrderItems.id, it.id));
    }
    return { ok: true as const, negatives };
  });
  if (res.ok) revalidate();
  return res;
}

export async function cancelPurchaseOrder(code: string): Promise<void> {
  const { storeId: sid } = await requireCapability("purchases:write");
  await withTenant(sid, async (db) => {
    const [po] = await db.select({ id: schema.purchaseOrders.id, status: schema.purchaseOrders.status }).from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.code, code))).limit(1);
    if (!po) return;
    // A RECEIVED PO already added its qty to inventory. Deleting it here left that stock on the shelf
    // with no PO backing it — counts and records permanently disagree, unreconcilable. Cancel is for
    // POs whose goods have NOT arrived. Once received, the way back is `unreceivePurchaseOrder`
    // ("Batalkan penerimaan" in the row menu) — it SUBTRACTS what the receipt added before returning
    // the PO to `dipesan`, so the shelf and the record move together. Cancel it after that if you
    // also want the PO gone. This used to say "undo = a separate stock adjustment", which described
    // a screen that did not exist: the merchant was left holding both the phantom stock and the
    // record, with no button for either.
    if (po.status === "diterima") {
      throw new Error("Pesanan pembelian yang sudah diterima tidak bisa dibatalkan.");
    }
    await db.delete(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.purchaseOrderId, po.id));
    await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, po.id));
  });
  revalidate();
}
