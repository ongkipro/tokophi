import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { orderLineItems, orders, payments } from "./schema";

function indexByName(table: PgTable, name: string) {
  const found = getTableConfig(table).indexes.find((index) => index.config.name === name);
  expect(found, `${name} must be declared in the Drizzle schema`).toBeDefined();
  return found!;
}

function columnNames(table: PgTable, name: string) {
  return indexByName(table, name).config.columns.map((column) =>
    "name" in column ? column.name : undefined,
  );
}

describe("migration lookup indexes are represented in the Drizzle schema", () => {
  it("declares the orders store/placed index", () => {
    expect(columnNames(orders, "orders_store_placed_idx")).toEqual(["storeId", "placedAt"]);
  });

  it("declares both partial payment lookup indexes", () => {
    const trx = indexByName(payments, "payments_trx_idx");
    const reff = indexByName(payments, "payments_reff_idx");

    expect(columnNames(payments, "payments_trx_idx")).toEqual(["trxId"]);
    expect(columnNames(payments, "payments_reff_idx")).toEqual(["reffId"]);
    expect(trx.config.where).toBeDefined();
    expect(reff.config.where).toBeDefined();
  });

  it("declares the order line-item lookup index", () => {
    expect(columnNames(orderLineItems, "order_line_items_order_idx")).toEqual(["orderId"]);
  });
});

// ── SENSUS: setiap index yang PERNAH dibuat sebuah migrasi harus punya keterangan ────────────────
//
// Empat pin di atas menyebut index satu per satu, dan sebuah daftar tangan adalah persis pola yang
// repo ini sudah bayar mahal berulang kali ("jangan ikat penjaga ke daftar target"): index ke-30
// yang lahir besok tidak akan pernah membuatnya merah. `TASKS.md` menyimpan follow-up "enam
// deklarasi index yang dipulihkan belum dipin"; diukur 2026-08-19 dari SQL + Drizzle, jumlahnya
// bukan enam melainkan **sembilan**, yang justru membuktikan kenapa angka di dokumen tidak boleh
// menggantikan pemeriksaan yang berjalan.
//
// Bentuknya meniru `rbac-census.test.ts`: setiap nama harus DIKLASIFIKASIKAN. Index baru di sebuah
// migrasi ⇒ merah sampai seseorang menuliskan ia ada di Drizzle atau kenapa hanya di SQL. Entri
// basi (index yang sudah tidak ada di migrasi mana pun) juga merah — sensus yang menyimpan hantu
// berhenti bisa dipercaya.
//
// ⚠️ "sql-only" BUKAN restu untuk mendeklarasikannya diam-diam di `schema.ts`. `drizzle-kit generate`
// memancarkan `CREATE INDEX` polos (tanpa IF NOT EXISTS), jadi mendeklarasikan index yang SUDAH ada
// di produksi memanggil migrasi yang gagal saat dijalankan — aturan idempotensi repo ini. Menutup
// jurangnya adalah kerja tersendiri dengan migrasi yang ditulis tangan, bukan efek samping.
type Census = "drizzle" | `sql-only: ${string}`;

const INDEX_CENSUS: Record<string, Census> = {
  // Dideklarasikan di schema.ts — parity nyata, diverifikasi oleh test di bawah.
  kelurahan_district_idx: "drizzle",
  ledger_one_retur_per_order: "drizzle",
  ledger_one_sale_per_order: "drizzle",
  ledger_one_sale_per_payment: "drizzle",
  ledger_store_status_idx: "drizzle",
  order_financials_store_idx: "drizzle",
  orders_store_placed_idx: "drizzle",
  payments_order_idx: "drizzle",
  payments_reff_idx: "drizzle",
  payments_store_request_key_unique: "drizzle",
  payments_trx_idx: "drizzle",
  product_taxonomy_path_idx: "drizzle",
  shipment_bookings_store_order_idx: "drizzle",
  shipment_one_active_per_order: "drizzle",
  store_domains_host_key: "drizzle",
  store_domains_one_primary: "drizzle",
  store_domains_store_idx: "drizzle",
  tracking_event_deliveries_due_idx: "drizzle",
  tracking_event_deliveries_order_idx: "drizzle",
  tracking_event_deliveries_store_idx: "drizzle",
  order_line_items_order_idx: "drizzle",
  menus_store_handle_unique: "drizzle",
  // Task 4.8. PARTIAL (`where checkout_session_id is not null`) — the whole point is that orders
  // WITHOUT a checkout session must not collide with one another, and drizzle's schema builder has
  // no way to express a partial unique index, so declaring it there would produce a DIFFERENT,
  // total index that would reject every second session-less order.
  orders_one_per_checkout_session: "sql-only: partial unique index, not expressible in schema.ts",
  // Task 8.26 / 0113. PARTIAL (`where kind = 'comp'`): one comp invoice per (store, grant instant), which
  // is what makes the audit-log backfill idempotent. Same reason as above — drizzle cannot express it.
  invoices_one_comp_per_grant: "sql-only: partial unique index, not expressible in schema.ts",
  impersonation_grants_token_hash_key: "drizzle",
  impersonation_grants_store_idx: "drizzle",
  // Task 8.31 (0112). PARTIAL (`where status in ('menunggu','diproses')`) — "one OPEN refund per
  // payment", so a settled row must not block a later obligation; same reason as
  // `orders_one_per_checkout_session`: the schema builder cannot express the WHERE.
  refunds_one_open_per_payment: "sql-only: partial unique index (one OPEN row per payment), not expressible in schema.ts",
  refunds_store_idx: "drizzle",
  refunds_order_idx: "drizzle",

  // Hidup HANYA di SQL. Bukan salah ketik — ini utang yang dinamai, bukan yang tak terlihat.
  ledger_one_adjustment_component_per_booking:
    "sql-only: unique parsial (WHERE) saudara dari tiga ledger_one_* yang sudah di Drizzle; belum ikut dipulihkan",
  checkout_sessions_store_session_uq: "sql-only: unique di (store_id, session_id) untuk tabel checkout_sessions",
  analytics_events_store_ts_idx: "sql-only: index pencarian polos (store_id, ts)",
  chat_visitors_store_customer_idx: "sql-only: index pencarian polos",
  checkout_sessions_store_status_idx: "sql-only: index pencarian polos",
  rate_limit_counters_expires_idx: "drizzle",
  // 0116: one leading index per FOREIGN KEY column (67 of them had none). Each is mirrored in schema.ts;
  // `fk-indexes.test.ts` is what keeps the next FK from arriving without one.
  ad_channels_store_idx: "drizzle",
  ad_metrics_store_idx: "drizzle",
  articles_blog_idx: "drizzle",
  blogs_store_idx: "drizzle",
  chat_visitors_customer_idx: "drizzle",
  checkout_sessions_customer_idx: "drizzle",
  collection_conditions_collection_idx: "drizzle",
  collection_products_product_idx: "drizzle",
  collections_template_idx: "drizzle",
  conversation_messages_sender_user_idx: "drizzle",
  conversation_messages_store_idx: "drizzle",
  conversations_assigned_user_idx: "drizzle",
  conversations_customer_idx: "drizzle",
  conversations_order_idx: "drizzle",
  conversations_visitor_idx: "drizzle",
  customer_addresses_customer_idx: "drizzle",
  customer_segments_store_idx: "drizzle",
  customers_store_idx: "drizzle",
  discount_usages_discount_idx: "drizzle",
  discount_usages_order_idx: "drizzle",
  domains_store_idx: "drizzle",
  flash_sale_items_product_idx: "drizzle",
  flash_sales_store_idx: "drizzle",
  followups_customer_idx: "drizzle",
  followups_store_idx: "drizzle",
  fulfillments_order_idx: "drizzle",
  impersonation_grants_operator_idx: "drizzle",
  impersonation_grants_user_idx: "drizzle",
  inventory_levels_location_idx: "drizzle",
  invoices_account_idx: "drizzle",
  landing_pages_product_idx: "drizzle",
  leads_store_idx: "drizzle",
  locations_store_idx: "drizzle",
  media_store_idx: "drizzle",
  menu_items_menu_idx: "drizzle",
  menu_items_parent_idx: "drizzle",
  notification_templates_store_idx: "drizzle",
  order_line_items_variant_idx: "drizzle",
  orders_customer_idx: "drizzle",
  page_templates_store_idx: "drizzle",
  payouts_store_idx: "drizzle",
  platform_activity_store_idx: "drizzle",
  product_media_product_idx: "drizzle",
  product_options_product_idx: "drizzle",
  product_variants_store_idx: "drizzle",
  products_google_category_idx: "drizzle",
  products_template_idx: "drizzle",
  promo_pages_product_idx: "drizzle",
  purchase_order_items_purchase_order_idx: "drizzle",
  purchase_order_items_variant_idx: "drizzle",
  purchase_orders_supplier_idx: "drizzle",
  reviews_customer_idx: "drizzle",
  reviews_product_idx: "drizzle",
  reviews_store_idx: "drizzle",
  stock_transfers_from_location_idx: "drizzle",
  stock_transfers_store_idx: "drizzle",
  stock_transfers_to_location_idx: "drizzle",
  store_users_user_idx: "drizzle",
  stores_account_idx: "drizzle",
  suppliers_store_idx: "drizzle",
  support_messages_store_idx: "drizzle",
  support_messages_ticket_idx: "drizzle",
  support_tickets_store_idx: "drizzle",
  wa_messages_followup_idx: "drizzle",
  wa_messages_lead_idx: "drizzle",
  wa_messages_store_idx: "drizzle",
  wa_templates_store_idx: "drizzle",
  conversation_messages_conv_created_idx: "sql-only: index pencarian polos",
  conversations_store_last_msg_idx: "sql-only: index pencarian polos",
  conversations_store_status_idx: "sql-only: index pencarian polos",
  conversations_store_visitor_idx: "sql-only: index pencarian polos",
};

/** Nama index → tabel, DITURUNKAN dari berkas migrasi. Tidak pernah ditulis tangan. */
function indexesInMigrations(): Map<string, string> {
  const dir = fileURLToPath(new URL("../drizzle/", import.meta.url));
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(dir + f, "utf8"))
    .join("\n");
  const found = new Map<string, string>();
  for (const m of sql.matchAll(
    /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?\s+on\s+"?([a-z0-9_]+)"?/gi,
  )) {
    found.set(m[1], m[2]);
  }
  return found;
}

/** Setiap nama index yang Drizzle deklarasikan, lintas seluruh tabel di schema.ts. */
function indexesDeclaredInDrizzle(): Set<string> {
  const names = new Set<string>();
  for (const value of Object.values(schema)) {
    if (!is(value as never, PgTable)) continue;
    const config = getTableConfig(value as PgTable);
    for (const index of config.indexes) if (index.config.name) names.add(index.config.name);
    for (const unique of config.uniqueConstraints ?? []) if (unique.name) names.add(unique.name);
  }
  return names;
}

describe("sensus index: migrasi ↔ Drizzle", () => {
  const inMigrations = indexesInMigrations();
  const inDrizzle = indexesDeclaredInDrizzle();

  it("benar-benar membaca berkas migrasinya (penjaga yang memindai nol berkas hijau selamanya)", () => {
    expect(inMigrations.size).toBeGreaterThan(20);
    expect(inDrizzle.size).toBeGreaterThan(20);
  });

  it("setiap index di migrasi sudah diklasifikasikan", () => {
    const unclassified = [...inMigrations.keys()].filter((name) => !(name in INDEX_CENSUS));
    expect(
      unclassified,
      "index baru di sebuah migrasi: tambahkan ke INDEX_CENSUS sebagai 'drizzle' (kalau schema.ts " +
        "mendeklarasikannya) atau 'sql-only: <alasan>'. Jangan hapus pemeriksaannya.",
    ).toEqual([]);
  });

  it("tidak menyimpan entri hantu (nama yang tidak ada di migrasi mana pun)", () => {
    const ghosts = Object.keys(INDEX_CENSUS).filter((name) => !inMigrations.has(name));
    expect(ghosts, "entri sensus tanpa index di migrasi — hapus, atau namanya salah tulis").toEqual([]);
  });

  it("yang ditandai 'drizzle' memang dideklarasikan schema.ts", () => {
    const lying = Object.entries(INDEX_CENSUS)
      .filter(([name, kind]) => kind === "drizzle" && !inDrizzle.has(name))
      .map(([name]) => name);
    expect(lying, "ditandai 'drizzle' tetapi tidak ada deklarasinya di schema.ts").toEqual([]);
  });

  it("yang ditandai 'sql-only' memang TIDAK ada di schema.ts — kalau sudah ada, sensusnya yang basi", () => {
    const stale = Object.entries(INDEX_CENSUS)
      .filter(([name, kind]) => kind !== "drizzle" && inDrizzle.has(name))
      .map(([name]) => name);
    expect(stale, "jurangnya sudah ditutup: ubah entri ini menjadi 'drizzle'").toEqual([]);
  });
});
