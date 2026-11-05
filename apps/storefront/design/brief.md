# UI brief — TokoΦ storefront redesign (round 1: core buying path)

Owner answers 2026-11-05. Scope: home → category/listing → PDP → cart → checkout, for EVERY
tenant (`<slug>.tokophi.id`). Blog, halaman, promo, kontak, LP follow later on the same system.

## Niche
Shopify-style commerce SaaS for Indonesia. Each store is a small Indonesian seller (demo:
`batiknusantara`, women's fashion) selling physical goods in IDR, mostly COD, traffic mostly paid
Meta/TikTok ads landing on a PDP or the home page.

## Audience
Indonesian shoppers on a phone (360–414 px), often arriving cold from an ad, usually as a guest
(no account). Before ordering they must trust that: the shop is real and reachable (WhatsApp,
address), the price + ongkir is final, COD is available, and the product looks like the photo
(reviews, sold count).

## Primary job
Get a cold visitor from landing to a product they want and through checkout in as few screens as
possible. Real content we have per store: product photos (AI-generated in the demo), prices with
compare-at, variants, sold counts, verified reviews, categories, blog posts, store WhatsApp/address.

## Primary action
Home/listing: open a product. PDP: **Beli Sekarang** (straight to checkout). Cart: Checkout.
Checkout: Buat Pesanan.

## References wanted
Owner picked Shopify Dawn / Horizon style (clean, big photos, minimal):
- https://theme-horizon-demo.myshopify.com/ (+ `/collections/all`, `/products/denim-jacket-324`)
- https://theme-dawn-demo.myshopify.com/ (+ `/collections/all`, `/products/puff-olive-leaf`)
- Baseline (what we replace): https://batiknusantara.tokophi.id/ (+ `/produk`, `/produk/celana-kulot`)
Teardowns in `design/refs/`.

## Non-goals
- No new merchant theme dials: the existing ones (brand colour, font pairing, tone, gallery layout,
  Store Builder sections) must keep working and every live store upgrades in place.
- No marketplace look (Shopee/Tokopedia badge noise), no editorial magazine home.
- No change to checkout LOGIC (ongkir, COD chain, validation, pixels) — presentation only.
- No deploy in this round: local first; the pre-redesign state is tagged
  `backup/storefront-pre-redesign-20261105` and archived in
  `/data/backups/tokophi-local/storefront-pre-redesign-20261105/`.
