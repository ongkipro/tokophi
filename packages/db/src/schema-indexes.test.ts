import { readFileSync, readdirSync } from "node:fs";
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
  // Task 4.8. PARTIAL (`where checkout_session_id is not null`) — the whole point is that orders
  // WITHOUT a checkout session must not collide with one another, and drizzle's schema builder has
  // no way to express a partial unique index, so declaring it there would produce a DIFFERENT,
  // total index that would reject every second session-less order.
  orders_one_per_checkout_session: "sql-only: partial unique index, not expressible in schema.ts",
  impersonation_grants_token_hash_key: "drizzle",
  impersonation_grants_store_idx: "drizzle",

  // Hidup HANYA di SQL. Bukan salah ketik — ini utang yang dinamai, bukan yang tak terlihat.
  ledger_one_adjustment_component_per_booking:
    "sql-only: unique parsial (WHERE) saudara dari tiga ledger_one_* yang sudah di Drizzle; belum ikut dipulihkan",
  checkout_sessions_store_session_uq: "sql-only: unique di (store_id, session_id) untuk tabel checkout_sessions",
  analytics_events_store_ts_idx: "sql-only: index pencarian polos (store_id, ts)",
  chat_visitors_store_customer_idx: "sql-only: index pencarian polos",
  checkout_sessions_store_status_idx: "sql-only: index pencarian polos",
  conversation_messages_conv_created_idx: "sql-only: index pencarian polos",
  conversations_store_last_msg_idx: "sql-only: index pencarian polos",
  conversations_store_status_idx: "sql-only: index pencarian polos",
  conversations_store_visitor_idx: "sql-only: index pencarian polos",
};

/** Nama index → tabel, DITURUNKAN dari berkas migrasi. Tidak pernah ditulis tangan. */
function indexesInMigrations(): Map<string, string> {
  const dir = new URL("../drizzle/", import.meta.url).pathname;
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
