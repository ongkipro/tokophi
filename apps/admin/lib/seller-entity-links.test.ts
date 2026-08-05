import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { textWithoutComments } from "../../../test/source-code";

const ADMIN = fileURLToPath(new URL("..", import.meta.url));

function expectCode(file: string, snippet: string) {
  const source = textWithoutComments(readFileSync(join(ADMIN, file), "utf8"));
  expect(source).toContain(textWithoutComments(snippet));
}

describe("Seller entity titles are navigation targets", () => {
  it("makes the topbar balance a direct link", () => {
    expectCode("components/admin/topbar.tsx", 'render={<Link href="/saldo" />}');
  });

  it("links primary list titles to their detail or editor route", () => {
    expectCode("app/(admin)/produk/produk-client.tsx", 'href={`/produk/${p.number ?? p.id}`}');
    expectCode("app/(admin)/blog/blog-client.tsx", 'href={`/blog/${p.id}`}');
    expectCode("app/(admin)/halaman/halaman-client.tsx", 'href={`/halaman/${p.id}`}');
    expectCode("app/(admin)/produk/kategori/kategori-client.tsx", 'href={`/produk/kategori/${c.id}`}');
    expectCode("app/(admin)/produk/inventori/inventori-client.tsx", 'href={`/produk/${p.number ?? p.id}`}');
    expectCode("app/(admin)/flash-sale/flash-sale-client.tsx", 'href={`/flash-sale/${s.id}`}');
    expectCode("app/(admin)/promo/promo-list-client.tsx", 'href={`/promo/${r.productId}`}');
    expectCode("app/(admin)/promo/promo-list-client.tsx", 'href={`/promo/html/${l.id}`}');
  });

  it("links order and dashboard entity summaries", () => {
    expectCode("components/admin/pesanan/order-product-cell.tsx", "<Link href={href}");
    expectCode("app/(admin)/pesanan/pesanan-client.tsx", 'href={`/pesanan/${o.number}`}');
    expectCode("components/admin/top-products.tsx", 'href={`/produk/${p.id}`}');
    expectCode("components/admin/recent-orders.tsx", 'href={`/pesanan/${o.id.replace(/^#/, "")}`}');
  });
});
