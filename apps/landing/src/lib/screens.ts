// Real product screenshots. Each `name` is a file stem in public/screens/ that exists in
// two widths (DESIGN.md: captured from the Dashboard Seller / demo storefront, never drawn). The
// intrinsic sizes below are the files' real dimensions — they reserve layout space (CLS 0).
export const FILES = {
  // Seller screens are clipped from the running panel (desktop 1180px, `-narrow` 390px) at a line no
  // row or card crosses; the builder at 1440px so its canvas shows whole tiles (review 2026-10-12).
  "seller-produk": [960, 1600, 1600, 1098],
  "seller-produk-editor": [960, 1600, 1600, 1803],
  "seller-pengiriman-massal": [960, 1600, 1600, 1033],
  "seller-saldo": [960, 1600, 1600, 652],
  "seller-pemasaran": [960, 1600, 1600, 559],
  "seller-produk-narrow": [480, 780, 780, 1068],
  "seller-produk-editor-narrow": [480, 780, 780, 575],
  "seller-pengiriman-massal-narrow": [480, 780, 780, 922],
  "seller-saldo-narrow": [480, 780, 780, 1344],
  "seller-pemasaran-narrow": [480, 780, 780, 576],
  "seller-store-builder-narrow": [480, 780, 780, 1091],
  "seller-store-builder": [960, 1600, 1600, 871],
  // Seller settings (Pengaturan → Pengiriman), desktop crops of one card each.
  "seller-cod": [720, 1200, 1200, 523],
  "seller-jasa-kirim": [720, 1170, 1170, 1146],
  // Demo checkout in four states (kecamatan chosen, QRIS, VA with banks, COD), one phone viewport each.
  "storefront-checkout-kecamatan": [480, 780, 780, 1688],
  "storefront-checkout-qris": [480, 780, 780, 1688],
  "storefront-checkout-va": [480, 780, 780, 1688],
  "storefront-checkout-cod": [480, 780, 780, 1688],
  "seller-daftar-mobile": [480, 780, 780, 1293],
  "storefront-produk-mobile": [480, 780, 780, 2248],
  "storefront-beranda-mobile": [480, 780, 780, 1433],
} satisfies Record<string, [small: number, large: number, w: number, h: number]>;

export type ScreenName = keyof typeof FILES;
