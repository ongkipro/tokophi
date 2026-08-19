"use server";
import { schema } from "@tokophi/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
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

export type CreatePurchaseOrderResult =
  | {
      ok: true;
      purchaseOrderId: string;
      code: string;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "supplier_not_found"
        | "supplier_ambiguous"
        | "variant_not_found"
        | "idempotency_conflict"
        | "save_failed";
      error: string;
    };

const REQUEST_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createPurchaseOrder(input: {
  requestKey: string;
  supplier: string;
  etaDate?: string;
  note?: string;
  lines: POLine[];
}): Promise<CreatePurchaseOrderResult> {
  const { storeId } = await requireCapability("purchases:write");
  const rawInput =
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? (input as unknown as Record<string, unknown>)
      : null;
  const rawLines = rawInput?.lines;
  if (
    !rawInput ||
    typeof rawInput.requestKey !== "string" ||
    typeof rawInput.supplier !== "string" ||
    (rawInput.etaDate != null && typeof rawInput.etaDate !== "string") ||
    (rawInput.note != null && typeof rawInput.note !== "string") ||
    !Array.isArray(rawLines) ||
    rawLines.length === 0
  ) {
    return {
      ok: false,
      code: "invalid_request",
      error: "Pemasok, varian, jumlah, dan biaya per unit wajib valid.",
    };
  }

  const requestKey = rawInput.requestKey.trim().toLowerCase();
  const supplierName = rawInput.supplier.trim();
  const etaDate = rawInput.etaDate?.trim() || null;
  const note = rawInput.note?.trim() || null;
  const lines: POLine[] = [];
  let total = 0;

  for (const rawLine of rawLines) {
    if (
      rawLine === null ||
      typeof rawLine !== "object" ||
      Array.isArray(rawLine)
    ) {
      return {
        ok: false,
        code: "invalid_request",
        error: "Pemasok, varian, jumlah, dan biaya per unit wajib valid.",
      };
    }

    const line = rawLine as Record<string, unknown>;
    const variantId =
      typeof line.variantId === "string" ? line.variantId.trim() : "";
    const qty = line.qty;
    const cost = line.cost;
    const lineTotal =
      typeof qty === "number" && typeof cost === "number" ? qty * cost : NaN;
    if (
      !REQUEST_KEY.test(variantId) ||
      !Number.isSafeInteger(qty) ||
      (qty as number) <= 0 ||
      !Number.isSafeInteger(cost) ||
      (cost as number) <= 0 ||
      !Number.isSafeInteger(lineTotal) ||
      !Number.isSafeInteger(total + lineTotal)
    ) {
      return {
        ok: false,
        code: "invalid_request",
        error: "Pemasok, varian, jumlah, dan biaya per unit wajib valid.",
      };
    }

    lines.push({
      variantId,
      qty: qty as number,
      cost: cost as number,
    });
    total += lineTotal;
  }

  if (
    !REQUEST_KEY.test(requestKey) ||
    !supplierName ||
    (etaDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(etaDate))
  ) {
    return {
      ok: false,
      code: "invalid_request",
      error: "Pemasok, varian, jumlah, dan biaya per unit wajib valid.",
    };
  }

  const variantIds = lines.map((line) => line.variantId);
  if (new Set(variantIds).size !== variantIds.length) {
    return {
      ok: false,
      code: "invalid_request",
      error: "Satu varian hanya boleh muncul sekali dalam pesanan.",
    };
  }

  // The caller keeps this UUID stable until it observes an accepted result. The existing
  // per-store unique PO code is therefore also the durable request claim; no second identity
  // column or migration is needed.
  const code = `PO-${requestKey.replaceAll("-", "").toUpperCase()}`;

  let result: CreatePurchaseOrderResult;
  try {
    result = await withTenant(storeId, async (db) => {
      const suppliers = await db
        .select({ id: schema.suppliers.id })
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.storeId, storeId),
            sql`lower(${schema.suppliers.name}) = ${supplierName.toLowerCase()}`,
          ),
        )
        .limit(2);
      if (suppliers.length === 0) {
        return {
          ok: false,
          code: "supplier_not_found",
          error: "Pemasok tidak ditemukan. Pilih pemasok yang sudah tersimpan.",
        } satisfies CreatePurchaseOrderResult;
      }
      if (suppliers.length > 1) {
        return {
          ok: false,
          code: "supplier_ambiguous",
          error: "Nama pemasok tidak unik. Rapikan data pemasok sebelum membuat PO.",
        } satisfies CreatePurchaseOrderResult;
      }

      const ownedVariants = await db
        .select({ id: schema.productVariants.id })
        .from(schema.productVariants)
        .where(
          and(
            eq(schema.productVariants.storeId, storeId),
            inArray(schema.productVariants.id, variantIds),
          ),
        );
      if (ownedVariants.length !== variantIds.length) {
        return {
          ok: false,
          code: "variant_not_found",
          error: "Salah satu varian tidak ditemukan atau bukan milik toko ini.",
        } satisfies CreatePurchaseOrderResult;
      }

      const [inserted] = await db
        .insert(schema.purchaseOrders)
        .values({
          storeId,
          supplierId: suppliers[0].id,
          code,
          status: "dipesan",
          totalIdr: total,
          etaDate,
          note,
        })
        .onConflictDoNothing({
          target: [schema.purchaseOrders.storeId, schema.purchaseOrders.code],
        })
        .returning({
          id: schema.purchaseOrders.id,
          code: schema.purchaseOrders.code,
        });

      if (!inserted) {
        const [existing] = await db
          .select({
            id: schema.purchaseOrders.id,
            supplierId: schema.purchaseOrders.supplierId,
            code: schema.purchaseOrders.code,
            totalIdr: schema.purchaseOrders.totalIdr,
            etaDate: schema.purchaseOrders.etaDate,
            note: schema.purchaseOrders.note,
          })
          .from(schema.purchaseOrders)
          .where(
            and(
              eq(schema.purchaseOrders.storeId, storeId),
              eq(schema.purchaseOrders.code, code),
            ),
          )
          .limit(1);
        if (!existing) throw new Error("purchase-order claim disappeared");

        const storedLines = await db
          .select({
            variantId: schema.purchaseOrderItems.variantId,
            qty: schema.purchaseOrderItems.qty,
            cost: schema.purchaseOrderItems.costIdr,
          })
          .from(schema.purchaseOrderItems)
          .where(eq(schema.purchaseOrderItems.purchaseOrderId, existing.id));
        const requestedLines = new Map(
          lines.map((line) => [line.variantId, line]),
        );
        const sameLines =
          storedLines.length === lines.length &&
          storedLines.every((line) => {
            const requested = line.variantId
              ? requestedLines.get(line.variantId)
              : undefined;
            return (
              requested?.qty === line.qty && requested.cost === line.cost
            );
          });
        if (
          existing.supplierId !== suppliers[0].id ||
          Number(existing.totalIdr) !== total ||
          existing.etaDate !== etaDate ||
          existing.note !== note ||
          !sameLines
        ) {
          return {
            ok: false,
            code: "idempotency_conflict",
            error: "Permintaan ini sudah dipakai untuk pesanan yang berbeda.",
          } satisfies CreatePurchaseOrderResult;
        }

        return {
          ok: true,
          purchaseOrderId: existing.id,
          code: existing.code,
          replayed: true,
        } satisfies CreatePurchaseOrderResult;
      }

      await db.insert(schema.purchaseOrderItems).values(
        lines.map((line) => ({
          purchaseOrderId: inserted.id,
          variantId: line.variantId,
          qty: line.qty,
          costIdr: line.cost,
          receivedQty: 0,
        })),
      );
      return {
        ok: true,
        purchaseOrderId: inserted.id,
        code: inserted.code,
        replayed: false,
      } satisfies CreatePurchaseOrderResult;
    });
  } catch {
    return {
      ok: false,
      code: "save_failed",
      error: "Pesanan gagal disimpan. Periksa data lalu coba lagi.",
    };
  }

  if (result.ok) revalidate();
  return result;
}

// Receive the goods: bump inventory by the outstanding qty of each line, mark received.
export async function receivePurchaseOrder(code: string): Promise<void> {
  const { storeId: sid } = await requireCapability("purchases:write");
  await withTenant(sid, async (db) => {
    // ⚠️ COMPARE-AND-SWAP FIRST, exactly like `unreceivePurchaseOrder` below — and the comment there
    // used to say this path did not need one, "because receive is naturally idempotent:
    // `add = qty - receivedQty` is 0 the second time". That is true of a RETRY and false of a RACE,
    // which is the whole distinction (Task 4.9). Two calls that overlap both SELECT `receivedQty = 0`
    // before either writes, so both compute `add = qty`; the inventory UPDATE is relative
    // (`available + add`), so the second one is not lost — it is APPLIED, and the shelf gains the
    // goods twice for one delivery. The relative UPDATE protects against a lost update; nothing was
    // protecting against a double application.
    //
    // This UPDATE …WHERE status <> 'diterima' claims the row under Postgres' own row lock: the
    // loser blocks, re-evaluates the predicate after the winner commits, matches zero rows, and
    // returns having written nothing. It is also the RLS-verified read of the parent id that the
    // CHILD-TABLE RULE requires before touching `purchase_order_items` / `inventory_levels` —
    // neither carries a `store_id`, while `purchase_orders` is policed, so a foreign code claims
    // nothing and we bail.
    //
    // Returning early on the loser is the ACCEPTED terminal result, not a swallowed error: the PO is
    // received, which is what the caller asked for. `revalidate()` still runs, so both tabs refresh.
    const claimed = await db
      .update(schema.purchaseOrders)
      .set({ status: "diterima" })
      .where(and(eq(schema.purchaseOrders.code, code), ne(schema.purchaseOrders.status, "diterima")))
      .returning({ id: schema.purchaseOrders.id });
    if (!claimed.length) return;
    const po = claimed[0];
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
    // No status write here: the claim above already made it `diterima`, inside this same transaction.
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
    // check. ⚠️ This comment used to add that the same read-then-check in `receivePurchaseOrder` was
    // "harmless there, because receive is naturally idempotent". It was not: idempotent describes a
    // RETRY, and two receives that OVERLAP both read `receivedQty = 0` and both add the full qty to
    // a relative UPDATE — the shelf gained the delivery twice. `receivePurchaseOrder` now claims the
    // row the same way this does (Task 4.9). A double-undo here would subtract the stock twice. This UPDATE …WHERE status='diterima' claims the row
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
