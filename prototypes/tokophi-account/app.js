const stores = {
  batik: { id: "11111111-1111-4111-8111-111111111111", slug: "batiknusantara", name: "Batik Nusantara", short: "BN", category: "Pakaian & Fashion", support: "WhatsApp Batik Nusantara", storefrontUrl: "https://batiknusantara.tokophi.id", available: true },
  kopi: { id: "22222222-2222-4222-8222-222222222222", slug: "kopi-senja", name: "Kopi Senja", short: "KS", category: "Makanan & Minuman", support: "WhatsApp Kopi Senja", storefrontUrl: null, available: false, unavailableReason: "Katalog Kopi Senja belum tersedia saat ini." },
  tech: { id: "33333333-3333-4333-8333-333333333333", slug: "techready", name: "TechReady", short: "TR", category: "Elektronik & Gadget", support: "Pusat bantuan TechReady", storefrontUrl: null, available: false, unavailableReason: "Katalog TechReady belum tersedia saat ini." },
};

const orderStatusMeta = {
  baru: { label: "Pesanan baru", className: "warning" },
  diproses: { label: "Sedang diproses", className: "processing" },
  dikirim: { label: "Dalam pengiriman", className: "shipped" },
  selesai: { label: "Pesanan selesai", className: "done" },
  batal: { label: "Pesanan dibatalkan", className: "warning" },
  retur: { label: "Pengembalian barang diproses", className: "processing" },
};
const financialStatusMeta = {
  pending: { label: "Menunggu pembayaran", className: "warning" },
  dibayar: { label: "Sudah dibayar", className: "connected" },
  refund_sebagian: { label: "Pengembalian dana sebagian", className: "processing" },
  refund: { label: "Dana sudah dikembalikan", className: "done" },
};

// Images are a derived current-catalog projection, not immutable order-line fields.
const catalogImages = {
  "dress-midi-motif-bunga": "/assets/dress-midi-bunga.webp",
  "kemeja-oversized-wanita": "/assets/kemeja-oversized.webp",
  "gayo-natural-250": "/assets/gayo-coffee.jpg",
  "mechanical-keyboard-k68": "/assets/mechanical-keyboard.jpg",
};

const orders = [
  {
    id: "a1111111-1111-4111-8111-111111111111", number: "PHI-202951778F2Y", storeId: stores.batik.id, storeSlug: stores.batik.slug,
    placedAt: "2026-08-10T09:14:00+07:00", displayDate: "10 Agustus 2026", status: "dikirim", financialStatus: "dibayar", channel: "organic",
    subtotalIdr: 309000, shippingIdr: 20000, taxIdr: 0, discountIdr: 0, totalIdr: 329000,
    courier: "jne", serviceType: "REG23", awb: "JP2048911701",
    shipRecipient: "Sari Andini", shipPhone: "6281234567890", shipAddress: "Jl. Tebet Timur Dalam VI No. 12, Tebet", shipPostcode: "12820", shipDistrictId: 3171090, city: "Jakarta Selatan", province: "DKI Jakarta",
    payment: { method: "va", status: "berhasil", provider: "autolaris", reffId: "PHI-202951778F2Y", trxId: "XID-5544692486", channelCode: "VAMANDIRI", amountIdr: 329000, adminFee: 0, total: 329000, virtualAccount: "88081234567890" },
    items: [
      { id: "b1111111-1111-4111-8111-111111111111", handle: "dress-midi-motif-bunga", variant: "Navy / M", title: "Dress Midi Motif Bunga — Navy / M", qty: 1, priceIdr: 189000, totalIdr: 189000 },
      { id: "b1111111-1111-4111-8111-111111111112", handle: "kemeja-oversized-wanita", variant: "Putih / L", title: "Kemeja Oversized Wanita — Putih / L", qty: 1, priceIdr: 120000, totalIdr: 120000 },
    ],
    timeline: [["Pesanan dibuat", "10 Agu · 09.14", true], ["Pembayaran dikonfirmasi", "10 Agu · 09.17", true], ["Diserahkan ke JNE", "11 Agu · 14.30", true], ["Pesanan diterima", "Menunggu konfirmasi penerimaan", false]],
  },
  {
    id: "a1111111-1111-4111-8111-111111111112", number: "PHI-202865413Q8M", storeId: stores.batik.id, storeSlug: stores.batik.slug,
    placedAt: "2026-08-09T13:05:00+07:00", displayDate: "9 Agustus 2026", status: "baru", financialStatus: "pending", channel: "organic",
    subtotalIdr: 189000, shippingIdr: 18000, taxIdr: 2000, discountIdr: 9000, totalIdr: 200000,
    courier: "spx", serviceType: "1", awb: null,
    shipRecipient: "Sari Andini", shipPhone: "6281234567890", shipAddress: "Menara Karya Lt. 8, Jl. H.R. Rasuna Said, Setiabudi", shipPostcode: "12950", shipDistrictId: 3171100, city: "Jakarta Selatan", province: "DKI Jakarta",
    payment: { method: "qris", status: "menunggu", provider: "autolaris", reffId: "PHI-202865413Q8M", trxId: "XID-5544692487", channelCode: "QRIS", amountIdr: 200000, adminFee: 0, total: 200000, qr: "fixture-qr-payload-not-rendered" },
    items: [{ id: "b1111111-1111-4111-8111-111111111113", handle: "dress-midi-motif-bunga", variant: "Navy / M", title: "Dress Midi Motif Bunga — Navy / M", qty: 1, priceIdr: 189000, totalIdr: 189000 }],
    timeline: [["Pesanan dibuat", "9 Agu · 13.05", true], ["Menunggu pembayaran", "Selesaikan pembayaran QRIS", false]],
  },
  {
    id: "a2222222-2222-4222-8222-222222222221", number: "PHI-202778031C4P", storeId: stores.kopi.id, storeSlug: stores.kopi.slug,
    placedAt: "2026-08-08T19:42:00+07:00", displayDate: "8 Agustus 2026", status: "diproses", financialStatus: "dibayar", channel: "organic",
    subtotalIdr: 118000, shippingIdr: 20000, taxIdr: 0, discountIdr: 0, totalIdr: 138000,
    courier: "sicepat", serviceType: "REG", awb: null,
    shipRecipient: "Sari Andini", shipPhone: "6281234567890", shipAddress: "Jl. Tebet Timur Dalam VI No. 12, Tebet", shipPostcode: "12820", shipDistrictId: 3171090, city: "Jakarta Selatan", province: "DKI Jakarta",
    payment: { method: "qris", status: "berhasil", provider: "autolaris", reffId: "PHI-202778031C4P", trxId: "XID-5544692488", channelCode: "QRIS", amountIdr: 138000, adminFee: 0, total: 138000 },
    items: [{ id: "b2222222-2222-4222-8222-222222222221", handle: "gayo-natural-250", variant: "Beans", title: "Gayo Natural 250 gr — Beans", qty: 2, priceIdr: 59000, totalIdr: 118000 }],
    timeline: [["Pesanan dibuat", "8 Agu · 19.42", true], ["Pembayaran dikonfirmasi", "8 Agu · 19.43", true], ["Sedang disiapkan", "Estimasi dikirim hari ini", true], ["Dikirim", "Menunggu nomor resi", false]],
  },
  {
    id: "a2222222-2222-4222-8222-222222222222", number: "PHI-202251814K7R", storeId: stores.kopi.id, storeSlug: stores.kopi.slug,
    placedAt: "2026-08-02T08:20:00+07:00", displayDate: "2 Agustus 2026", status: "batal", financialStatus: "refund", channel: "organic",
    subtotalIdr: 59000, shippingIdr: 18000, taxIdr: 1000, discountIdr: 3000, totalIdr: 75000,
    courier: "jnt", serviceType: "EZ", awb: null,
    shipRecipient: "Sari Andini", shipPhone: "6281234567890", shipAddress: "Jl. Tebet Timur Dalam VI No. 12, Tebet", shipPostcode: "12820", shipDistrictId: 3171090, city: "Jakarta Selatan", province: "DKI Jakarta",
    payment: { method: "va", status: "berhasil", provider: "autolaris", reffId: "PHI-202251814K7R", trxId: "XID-5544692489", channelCode: "VABCA", amountIdr: 75000, adminFee: 0, total: 75000 },
    items: [{ id: "b2222222-2222-4222-8222-222222222222", handle: "gayo-natural-250", variant: "Beans", title: "Gayo Natural 250 gr — Beans", qty: 1, priceIdr: 59000, totalIdr: 59000 }],
    timeline: [["Pesanan dibuat", "2 Agu · 08.20", true], ["Pesanan dibatalkan", "2 Agu · 09.10", true], ["Refund selesai", "3 Agu · 11.45", true]],
  },
  {
    id: "a3333333-3333-4333-8333-333333333331", number: "PHI-202810927M5D", storeId: stores.tech.id, storeSlug: stores.tech.slug,
    placedAt: "2026-07-28T10:02:00+07:00", displayDate: "28 Juli 2026", status: "selesai", financialStatus: "dibayar", channel: "organic",
    subtotalIdr: 349000, shippingIdr: 0, taxIdr: 0, discountIdr: 20000, totalIdr: 329000,
    courier: "spx", serviceType: "1", awb: "SPXID0480191719",
    shipRecipient: "Sari Andini", shipPhone: "6281234567890", shipAddress: "Jl. Tebet Timur Dalam VI No. 12, Tebet", shipPostcode: "12820", shipDistrictId: 3171090, city: "Jakarta Selatan", province: "DKI Jakarta",
    payment: { method: "cod", status: "berhasil", provider: "cod", reffId: "PHI-202810927M5D", trxId: null, channelCode: "COD", amountIdr: 329000, adminFee: 0, total: 329000 },
    items: [{ id: "b3333333-3333-4333-8333-333333333331", handle: "mechanical-keyboard-k68", variant: "Graphite", title: "Mechanical Keyboard K68 — Graphite", qty: 1, priceIdr: 349000, totalIdr: 349000 }],
    timeline: [["Pesanan dibuat", "28 Jul · 10.02", true], ["Dikirim", "29 Jul · 15.17", true], ["Pesanan selesai", "31 Jul · 13.08", true]],
  },
  {
    id: "a3333333-3333-4333-8333-333333333332", number: "PHI-202114620V9N", storeId: stores.tech.id, storeSlug: stores.tech.slug,
    placedAt: "2026-07-20T16:18:00+07:00", displayDate: "20 Juli 2026", status: "retur", financialStatus: "refund_sebagian", channel: "organic",
    subtotalIdr: 698000, shippingIdr: 25000, taxIdr: 7000, discountIdr: 30000, totalIdr: 700000,
    courier: "jne", serviceType: "YES23", awb: "JP2048011719",
    shipRecipient: "Sari Andini", shipPhone: "6281234567890", shipAddress: "Menara Karya Lt. 8, Jl. H.R. Rasuna Said, Setiabudi", shipPostcode: "12950", shipDistrictId: 3171100, city: "Jakarta Selatan", province: "DKI Jakarta",
    payment: { method: "va", status: "berhasil", provider: "autolaris", reffId: "PHI-202114620V9N", trxId: "XID-5544692490", channelCode: "VAMANDIRI", amountIdr: 700000, adminFee: 0, total: 700000 },
    items: [{ id: "b3333333-3333-4333-8333-333333333332", handle: "mechanical-keyboard-k68", variant: "Graphite", title: "Mechanical Keyboard K68 — Graphite", qty: 2, priceIdr: 349000, totalIdr: 698000 }],
    timeline: [["Pesanan dibuat", "20 Jul · 16.18", true], ["Pesanan diterima", "23 Jul · 13.08", true], ["Retur diajukan", "24 Jul · 09.22", true], ["Refund sebagian", "Sedang diproses", false]],
  },
];


const urlParams = new URLSearchParams(window.location.search);
const codParam = urlParams.get('cod');
const codState = {
  status: ['restricted', 'warning'].includes(codParam) ? codParam : 'normal',
  verifiedRefusals: codParam === 'restricted' ? 3 : 2,
  threshold: 3,
  windowDays: 180,
  restrictionDays: 90,
  restrictionEndsAt: "9 November 2026"
};

const renderCodTrustCard = () => {
  if (codState.status === "normal") return "";
  const isRestricted = codState.status === "restricted";
  return `<section class="section-card ${isRestricted ? "danger-border" : "warning-border"}" style="border: 1px solid ${isRestricted ? "var(--destructive)" : "var(--warning-dark, #b45309)"}; background: ${isRestricted ? "color-mix(in oklch, var(--destructive) 5%, transparent)" : "color-mix(in oklch, #b45309 5%, transparent)"}">
    <div class="section-heading">
      <h2>Status akses COD</h2>
      <span class="badge ${isRestricted ? "danger" : "warning"}">${isRestricted ? "Dibatasi sementara" : "Peringatan"}</span>
    </div>
    <p class="lead">${codState.verifiedRefusals} dari ${codState.threshold} penolakan terverifikasi dalam ${codState.windowDays} hari terakhir.</p>
    <div style="margin: 16px 0;">
      <meter min="0" max="${codState.threshold}" value="${codState.verifiedRefusals}" low="${codState.threshold - 1}" high="${codState.threshold}" optimum="0" aria-label="${codState.verifiedRefusals} dari ${codState.threshold} kejadian terverifikasi" style="width: 100%; height: 12px;"></meter>
    </div>
    ${isRestricted
      ? `<p class="lead">COD dinonaktifkan sampai ${codState.restrictionEndsAt}. Metode prabayar seperti VA dan QRIS tetap tersedia.</p>`
      : `<p class="lead">Satu penolakan terverifikasi lagi akan membatasi COD selama ${codState.restrictionDays} hari. Metode prabayar tetap tersedia.</p>`
    }
    <details style="margin-top: 16px; font-size: 14px; color: var(--muted-foreground);">
      <summary style="cursor: pointer; font-weight: 500;">Bagaimana ini dihitung?</summary>
      <div style="margin-top: 8px; padding: 12px; background: var(--sunken); border-radius: 4px;">
        <p style="margin-bottom: 8px;">Hanya penolakan kurir dengan kode 310 (penerima merasa tidak memesan) dan 311 (penerima menolak membayar COD) yang dihitung setelah peninjauan. Kode 301, masalah pengiriman, pembatalan penjual, dan perselisihan yang belum selesai tidak dihitung.</p>
        <p style="margin-bottom: 8px;">Kecocokan nomor telepon atau alamat hanya membantu peninjauan identitas. Kecocokan itu tidak membuat catatan atau blacklist permanen dengan sendirinya.</p>
        <p>Setiap catatan kedaluwarsa setelah ${codState.windowDays} hari. Bukti yang dibatalkan atau banding yang diterima menghapus catatan terkait.</p>
      </div>
    </details>
    <div style="margin-top: 16px;"><button class="button secondary" type="button" data-action="cod-review">Ajukan peninjauan</button></div>
    <small class="prototype-note">Kebijakan COD dievaluasi berkala berdasarkan riwayat penyelesaian pesanan Anda.</small>
  </section>`;
};

const prototypeNow = new Date("2026-08-11T12:00:00+07:00");
const batikVouchers = [
  { code: "GAJIAN25", kind: "persen", value: 25, minPurchaseIdr: 100000, startsAt: "2026-07-25T00:00:00+07:00", endsAt: "2026-08-31T23:59:59+07:00", status: "aktif", usageLimit: 1000, usedCount: 250 },
  { code: "ONGKIRGRATIS", kind: "gratis_ongkir", value: 0, minPurchaseIdr: 50000, startsAt: "2026-08-01T00:00:00+07:00", endsAt: "2026-08-31T23:59:59+07:00", status: "aktif", usageLimit: 5000, usedCount: 1500 },
  { code: "NEWUSER50K", kind: "nominal", value: 50000, minPurchaseIdr: 200000, startsAt: "2026-01-01T00:00:00+07:00", endsAt: "2026-12-31T23:59:59+07:00", status: "aktif", usageLimit: 500, usedCount: 120 },
];
const activeVouchersForStore = (storeKey) => storeKey === "batik" ? batikVouchers.filter((voucher) =>
  voucher.status !== "nonaktif" &&
  (!voucher.startsAt || prototypeNow >= new Date(voucher.startsAt)) &&
  (!voucher.endsAt || prototypeNow < new Date(voucher.endsAt)) &&
  (voucher.usageLimit == null || voucher.usedCount < voucher.usageLimit)
) : [];
const voucherValueLabel = (voucher) => voucher.kind === "persen"
  ? `Diskon ${voucher.value}%`
  : voucher.kind === "gratis_ongkir"
    ? "Gratis Ongkir"
    : `Potongan ${money(voucher.value)}`;

const notifications = [
  { id: "notif-promo-batik", type: "promo", title: "Voucher baru dari Batik Nusantara", body: "Gunakan voucher GAJIAN25 untuk diskon 25% belanja Anda.", date: "11 Agu 2026", isRead: false, route: "/stores/batiknusantara", storeName: "Batik Nusantara" },
];

orders.forEach((order, index) => {
  if (order.timeline?.length) {
    const lastEvent = order.timeline[order.timeline.length - 1];
    const store = storeForOrder(order);
    notifications.push({
      id: `notif-order-${order.id}`,
      type: "order",
      title: `Update pesanan dari ${store.name}`,
      body: `${lastEvent[0]}. ${lastEvent[1]}`,
      date: order.displayDate,
      isRead: index > 1,
      route: `/orders/${order.number}`,
      storeName: store.name,
    });
  }
});
const initialNotificationReadStates = notifications.map((notification) => notification.isRead);

const tenantCustomers = {
  batik: { id: "c1111111-1111-4111-8111-111111111111", storeId: stores.batik.id, joined: "12 Jan 2026", segment: "Loyal", metrics: { spentIdr: 529000, orderCount: 2 }, last: "1 hari lalu", notes: "Menyukai koleksi outer dan warna netral." },
  kopi: { id: "c2222222-2222-4222-8222-222222222222", storeId: stores.kopi.id, joined: "8 Agu 2026", segment: "Baru", metrics: { spentIdr: 213000, orderCount: 2 }, last: "3 hari lalu", notes: "Belum ada catatan merchant." },
  tech: { id: "c3333333-3333-4333-8333-333333333333", storeId: stores.tech.id, joined: "28 Jul 2026", segment: "Reguler", metrics: { spentIdr: 1029000, orderCount: 2 }, last: "14 hari lalu", notes: "Memilih pengiriman reguler." },
};

// Prototype-only planned account projection. The current per-store customer address
// table has no districtId/destId; no central account/address API exists yet.
const addresses = [
  { id: "d1111111-1111-4111-8111-111111111111", label: "Rumah", recipient: "Sari Andini", phone: "+6281234567890", email: "", addressLine: "Jl. Tebet Timur Dalam VI No. 12, Tebet", city: "Jakarta Selatan", province: "DKI Jakarta", postcode: "12820", districtId: 3171090, districtLabel: "Kecamatan Tebet", primary: true },
  { id: "d2222222-2222-4222-8222-222222222222", label: "Kantor", recipient: "Sari Andini", phone: "+6281234567890", email: "sari@example.test", addressLine: "Menara Karya Lt. 8, Jl. H.R. Rasuna Said, Setiabudi", city: "Jakarta Selatan", province: "DKI Jakarta", postcode: "12950", districtId: 3171100, districtLabel: "Kecamatan Setiabudi", primary: false },
];

const money = (value) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
const content = document.querySelector("#content");
const buyerShell = document.querySelector("#buyer-shell");
const merchantShell = document.querySelector("#merchant-shell");
const merchantContent = document.querySelector("#merchant-content");
const toast = document.querySelector("#toast");
const demo = {
  profile: { name: "Sari Andini", phone: "6281234567890", email: "" },
  preferences: { updates: true, promos: false },
  connections: ["batik", "kopi", "tech"],
  sessions: [{ id: "other", name: "Chrome · perangkat contoh", last: "Kemarin, 15.20 WIB" }],
  requests: [], claimed: false, signedIn: false,
};
const storageKey = "tokophi-account-demo-v1";
try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
  if (saved?.version === 1) {
    Object.assign(demo, saved.demo);
    addresses.splice(0, addresses.length, ...saved.addresses);
  }
} catch { /* A blocked or cleared browser store starts a fresh demo. */ }
function saveDemo() {
  try { sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, demo, addresses })); return true; }
  catch { showToast("Penyimpanan tab tidak tersedia. Perubahan bertahan sampai halaman dimuat ulang."); return false; }
}
function accountOrders() {
  return (demo.claimed ? [...orders, claimedOrder] : orders).map(order => demo.payments?.[order.number] === 'paid' ? {...order, financialStatus:'dibayar', payment:{...order.payment,status:'berhasil'}} : order);
}
const claimedOrder = { ...structuredClone(orders[2]), id: "guest-demo", number: "DEMO-GUEST-001", displayDate: "11 Agustus 2026" };
let ordersReturnUrl = "/orders";
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function updateNotificationBadge() {
  const unreadCount = notifications.filter((notification) => !notification.isRead).length;
  const badge = document.getElementById("unread-badge");
  const notificationButton = document.querySelector('[data-route="notifications"]');
  if (badge) {
    badge.hidden = unreadCount === 0;
    badge.textContent = String(unreadCount);
  }
  if (notificationButton) {
    notificationButton.setAttribute("aria-label", unreadCount > 0 ? `Notifikasi, ${unreadCount} belum dibaca` : "Notifikasi, tidak ada yang baru");
  }
}

const displayProductTitle = (item) => item.title.replace(/\s+[—–]\s+/g, ": ");

function productThumb(item, sizeClass = "") {
  const image = item ? catalogImages[item.handle] : null;
  if (!image) return `<div class="product-thumb fallback ${sizeClass}" role="img" aria-label="Gambar produk"><svg width="${sizeClass === "large" ? "24" : "18"}" height="${sizeClass === "large" ? "24" : "18"}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg></div>`;
  return `<img src="${image}" alt="${displayProductTitle(item)}" class="product-thumb ${sizeClass}" loading="lazy">`;
}

function storeForOrder(order) { return Object.values(stores).find((store) => store.id === order.storeId); }
const storeKeyForOrder = (order) => Object.keys(stores).find((key) => stores[key].id === order.storeId);
const partialNotice = (message) => `<div class="privacy-note" role="status"><strong>Data baru dimuat sebagian.</strong> ${message} <button class="link-button" type="button" data-retry-scenario>Coba lagi</button></div>`;
const statusBadge = (order) => {
  const meta = orderStatusMeta[order.status];
  return `<span class="badge ${meta.className}">${meta.label}</span>`;
};
const financialBadge = (order) => {
  const meta = financialStatusMeta[order.financialStatus];
  return `<span class="badge ${meta.className}">${meta.label}</span>`;
};
const paymentMethodLabels = { transfer: "Transfer bank", qris: "QRIS", va: "Virtual account", cod: "Bayar di tempat" };
const paymentStatusLabels = { menunggu: "Menunggu pembayaran", berhasil: "Pembayaran berhasil", gagal: "Pembayaran gagal" };
const courierLabels = { jne: "JNE", spx: "SPX", sicepat: "SiCepat", jnt: "J&T" };
const formatPhoneId = (value) => {
  const digits = String(value).replace(/\D/g, "").replace(/^62/, "");
  return `+62 ${digits.replace(/(\d{3})(\d{4})(\d+)/, "$1-$2-$3")}`;
};
const paymentDetail = (payment) => {
  if (payment.virtualAccount) return `VA ${payment.channelCode}: ${payment.virtualAccount}`;
  if (payment.qr) return "Kode QR atau tautan pembayaran belum tersedia.";
  if (payment.method === "cod") return "Dibayar kepada kurir saat pesanan diserahkan.";
  return "Tidak ada instruksi pembayaran aktif.";
};
const paymentReference = (order) => `<dl class="transaction-refs">
  <div><dt>Nomor pesanan</dt><dd>${order.number}</dd></div>
  <div><dt>Referensi pembayaran</dt><dd>${order.payment.reffId}</dd></div>
  ${order.payment.trxId ? `<div><dt>ID transaksi gateway</dt><dd>${order.payment.trxId}</dd></div>` : ""}
</dl>`;

function currentScenario() {
  const value = new URLSearchParams(window.location.search).get("scenario") || "normal";
  return ["loading", "empty", "error", "partial", "reprice"].includes(value) ? value : "normal";
}

function orderCard(order) {
  const store = storeForOrder(order);
  return `<button class="order-card" type="button" data-order="${order.number}" aria-label="Buka pesanan ${order.number} dari ${store.name}">
    ${productThumb(order.items[0])}
    <span class="order-main"><span class="order-topline"><strong>${store.name}</strong>${order.financialStatus === "pending" ? financialBadge(order) : statusBadge(order)}</span><span class="order-meta">${order.displayDate} · ${order.items.length > 1 ? `${order.items.length} produk` : displayProductTitle(order.items[0])}</span></span>
    <span class="order-total"><strong>${money(order.totalIdr)}</strong><span>${nextOrderAction(order)[0]} →</span></span>
  </button>`;
}

function pageHeader(eyebrow, title, lead, action = "") {
  return `<header class="page-header"><div><h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ""}</div>${action}</header>`;
}

function renderScenarioState(route) {
  const scenario = currentScenario();
  if (!["loading", "empty", "error"].includes(scenario)) return false;
  const labels = { dashboard: ["BERANDA", "Dashboard Pembeli"], orders: ["PESANAN", "Pesanan Anda"], stores: ["TOKO", "Toko tempat Anda berbelanja"], addresses: ["ALAMAT", "Alamat tersimpan"], profile: ["AKUN", "Profil & keamanan"] };
  const baseRoute = route.startsWith("order") ? "orders" : route;
  const [eyebrow, title] = labels[baseRoute] || labels.orders;
  if (scenario === "loading") {
    content.innerHTML = `${pageHeader(eyebrow, title, "Memuat data...")}<div class="skeleton-group" role="status" aria-live="polite" aria-busy="true"><div class="skeleton-block"></div><div class="skeleton-block"></div><div class="skeleton-block"></div></div>`;
  } else if (scenario === "empty") {
    const emptyCopy = { dashboard: "Belum ada aktivitas pesanan.", orders: "Belum ada pesanan yang terhubung ke akun ini.", stores: "Belum ada riwayat toko belanja Anda.", addresses: "Belum ada alamat yang tersimpan.", profile: "Belum ada data profil untuk ditampilkan." };
    content.innerHTML = `${pageHeader(eyebrow, title, "Belum ada data")}<section class="state-card" role="status"><h2>Belum ada data</h2><p>${emptyCopy[baseRoute]}</p>${baseRoute === "orders" ? '<button class="button primary" data-action="claim" type="button">Cari pesanan saya</button>' : baseRoute === "addresses" ? '<button class="button primary" data-action="address" type="button">Tambah alamat</button>' : '<a href="/orders" class="button secondary">Lihat pesanan</a>'}</section>`;
  } else {
    content.innerHTML = `${pageHeader(eyebrow, title, "Gagal memuat data")}<section class="state-card" role="alert"><h2>Terjadi kendala</h2><p>Data akun gagal dimuat. Silakan coba beberapa saat lagi.</p><button class="button primary" type="button" data-retry-scenario>Coba lagi</button></section>`;
  }
  return true;
}

function renderDashboard() {
  if (renderScenarioState("dashboard")) return;
  const allOrders = accountOrders();
  const pendingOrders = allOrders.filter(o => o.financialStatus === "pending");
  const shippingOrders = allOrders.filter(o => o.status === "dikirim");
  const activeOrders = allOrders.filter(o => ["baru", "diproses", "dikirim"].includes(o.status));
  const recentOrders = allOrders.slice(0, 3);
  
  const buyAgainItems = [];
  const seenHandles = new Set();
  allOrders.forEach(o => {
    const s = storeForOrder(o);
    o.items.forEach(it => {
      if (!seenHandles.has(it.handle)) {
        seenHandles.add(it.handle);
        buyAgainItems.push({ item: it, store: s, order: o });
      }
    });
  });

  let html = pageHeader("", `Halo, ${demo.profile.name}`, "Ringkasan aktivitas pesanan, pengiriman, dan rekomendasi belanja Anda.");

  if (pendingOrders.length > 0) {
    const pOrder = pendingOrders[0];
    const pStore = storeForOrder(pOrder);
    html += `
      <section class="action-hub-card" style="background: color-mix(in oklab, #f59e0b 8%, var(--card)); border: 1px solid color-mix(in oklab, #f59e0b 22%, var(--border)); border-radius: var(--radius-lg); padding: 18px 20px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span class="badge warning">Perlu Tindakan</span>
              <span style="font-size: 13px; color: var(--muted-foreground);">Batas waktu 30 menit</span>
            </div>
            <h2 style="font-size: 16px; margin: 0 0 6px 0; font-weight: 600;">1 Pesanan Menunggu Pembayaran</h2>
            <p style="margin: 0; color: var(--muted-foreground); font-size: 14px;">
              <strong>${pStore.name}</strong> · ${pOrder.number} · <strong style="color: var(--foreground);">${money(pOrder.totalIdr)}</strong> via ${paymentMethodLabels[pOrder.payment.method]}
            </p>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <a href="/orders/${pOrder.number}/payment" class="button primary">Bayar Sekarang</a>
            <a href="/orders/${pOrder.number}" class="button secondary">Detail</a>
          </div>
        </div>
      </section>
    `;
  }

  if (shippingOrders.length > 0) {
    const sOrder = shippingOrders[0];
    const sStore = storeForOrder(sOrder);
    const lastEvent = sOrder.timeline && sOrder.timeline.length ? sOrder.timeline[sOrder.timeline.length - 2] : null;
    html += `
      <section class="active-shipment-card" style="background: color-mix(in oklab, var(--primary) 5%, var(--card)); border: 1px solid color-mix(in oklab, var(--primary) 20%, var(--border)); border-radius: var(--radius-lg); padding: 18px 20px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span class="badge shipped">Sedang Dikirim</span>
              <span style="font-size: 13px; color: var(--muted-foreground);">${courierLabels[sOrder.courier] || sOrder.courier} · Resi: <strong>${sOrder.awb || "—"}</strong></span>
            </div>
            <h2 style="font-size: 16px; margin: 0 0 6px 0; font-weight: 600;">Paket dari ${sStore.name} Sedang Menuju Alamat Anda</h2>
            <p style="margin: 0; color: var(--muted-foreground); font-size: 14px;">
              ${lastEvent ? `${lastEvent[0]} (${lastEvent[1]})` : 'Pesanan telah diserahkan ke pihak ekspedisi.'}
            </p>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <a href="/orders/${sOrder.number}/tracking" class="button primary">Lacak Pengiriman</a>
            ${sOrder.awb ? `<button class="button secondary" type="button" data-copy-text="${sOrder.awb}" data-copy-message="Nomor resi berhasil disalin!">Salin Resi</button>` : ''}
          </div>
        </div>
      </section>
    `;
  }

  html += `
    <div class="dashboard-stats-grid">
      <a href="/orders" class="section-card dashboard-stat-card">
        <span style="font-size: 13px; color: var(--muted-foreground); font-weight: 500; display: block; margin-bottom: 4px;">Total Pesanan</span>
        <strong style="font-size: 26px; font-weight: 700; color: var(--foreground);">${allOrders.length}</strong>
        <span style="display: block; font-size: 12px; color: var(--primary); margin-top: 4px;">${activeOrders.length} pesanan aktif →</span>
      </a>
      <a href="/stores" class="section-card dashboard-stat-card">
        <span style="font-size: 13px; color: var(--muted-foreground); font-weight: 500; display: block; margin-bottom: 4px;">Toko Terhubung</span>
        <strong style="font-size: 26px; font-weight: 700; color: var(--foreground);">${demo.connections.length}</strong>
        <span style="display: block; font-size: 12px; color: var(--primary); margin-top: 4px;">Kelola izin toko →</span>
      </a>
      <a href="/addresses" class="section-card dashboard-stat-card">
        <span style="font-size: 13px; color: var(--muted-foreground); font-weight: 500; display: block; margin-bottom: 4px;">Alamat Tersimpan</span>
        <strong style="font-size: 26px; font-weight: 700; color: var(--foreground);">${addresses.length}</strong>
        <span style="display: block; font-size: 12px; color: var(--primary); margin-top: 4px;">1 Alamat utama →</span>
      </a>
      <div class="section-card dashboard-stat-card">
        <span style="font-size: 13px; color: var(--muted-foreground); font-weight: 500; display: block; margin-bottom: 4px;">Voucher Tersedia</span>
        <strong style="font-size: 26px; font-weight: 700; color: var(--foreground);">${batikVouchers.length}</strong>
        <span style="display: block; font-size: 12px; color: #166534; margin-top: 4px;">Diskon s.d. 25% aktif</span>
      </div>
    </div>
  `;

  html += `<div class="detail-grid">
    <div class="stack">
      <div class="dashboard-section">
        <div class="section-heading" style="margin-bottom: 12px;">
          <h2 style="font-size: 16px; font-weight: 600; margin: 0;">Pesanan Terbaru</h2>
          <a href="/orders" class="link-button">Lihat semua (${allOrders.length})</a>
        </div>
        <div class="order-list" style="margin: 0; border: 0;">
          ${recentOrders.map(orderCard).join('')}
        </div>
      </div>

      <div class="dashboard-section" style="margin-top: 24px;">
        <div class="section-heading" style="margin-bottom: 12px;">
          <h2 style="font-size: 16px; font-weight: 600; margin: 0;">Beli Lagi</h2>
          <span style="font-size: 13px; color: var(--muted-foreground);">Pesan kembali barang favorit Anda</span>
        </div>
        <div class="buy-again-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px;">
          ${buyAgainItems.slice(0, 3).map(({ item, store, order }) => `
            <div class="buy-again-card">
              <div>
                <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                  ${productThumb(item, "")}
                  <div style="min-width: 0;">
                    <span style="font-size: 10px; text-transform: uppercase; font-weight: 600; color: var(--muted-foreground);">${store.name}</span>
                    <strong style="display: block; font-size: 12px; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayProductTitle(item)}</strong>
                  </div>
                </div>
                <strong style="font-size: 13px; color: var(--foreground);">${money(item.priceIdr)}</strong>
              </div>
              <div style="display: flex; gap: 4px; margin-top: 10px;">
                ${store.available && store.storefrontUrl ? `<a href="${store.storefrontUrl}/produk/${item.handle}" target="_blank" rel="noopener noreferrer" class="button secondary" style="flex: 1; font-size: 11px; min-height: 28px; height: 28px; padding: 0 6px;">Beli Lagi</a>` : `<a href="/orders/${order.number}" class="button secondary" style="flex: 1; font-size: 11px; min-height: 28px; height: 28px; padding: 0 6px;">Buka Pesanan</a>`}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="stack">
      <div class="dashboard-section">
        <div class="section-heading" style="margin-bottom: 12px;">
          <h2 style="font-size: 16px; font-weight: 600; margin: 0;">Voucher Belanja</h2>
          <a href="/stores/batiknusantara" class="link-button">Lihat promo</a>
        </div>
        <p style="font-size: 13px; color: var(--muted-foreground); margin: 0 0 12px 0;">Gunakan kode voucher saat checkout di toko terhubung.</p>
        <div style="display: grid; gap: 10px;">
          ${batikVouchers.map(v => `
            <div class="voucher-ticket">
              <div style="min-width: 0;">
                <strong style="font-size: 14px; display: block; color: var(--foreground);">${voucherValueLabel(v)}</strong>
                <span style="font-size: 12px; color: var(--muted-foreground);">Min. ${money(v.minPurchaseIdr)} · Batik Nusantara</span>
              </div>
              <button type="button" class="button secondary" data-copy-code="${v.code}" style="flex-shrink: 0; min-height: 32px; height: 32px; padding: 0 10px; font-size: 12px; font-family: monospace; font-weight: 600;">${v.code}</button>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="dashboard-section" style="margin-top: 24px;">
        <div class="section-heading" style="margin-bottom: 12px;">
          <h2 style="font-size: 16px; font-weight: 600; margin: 0;">Bantuan & Layanan</h2>
        </div>
        <div class="service-menu-card">
          <button class="service-menu-item" type="button" data-action="claim">
            <div style="display: flex; align-items: center; gap: 10px;">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <span>Klaim pesanan checkout tanpa akun</span>
            </div>
            <span style="color: var(--muted-foreground); font-size: 14px;">→</span>
          </button>
          <a href="/addresses" class="service-menu-item">
            <div style="display: flex; align-items: center; gap: 10px;">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              <span>Tambah atau ubah alamat pengiriman</span>
            </div>
            <span style="color: var(--muted-foreground); font-size: 14px;">→</span>
          </a>
          <a href="/account" class="service-menu-item">
            <div style="display: flex; align-items: center; gap: 10px;">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <span>Keluar dari perangkat lain & keamanan</span>
            </div>
            <span style="color: var(--muted-foreground); font-size: 14px;">→</span>
          </a>
        </div>
      </div>
    </div>
  </div>`;

  content.innerHTML = html;
}

function renderOrders() {
  const params = new URLSearchParams(location.search);
  const search = params.get("q") || "";
  const selectedStore = params.get("store") || "";
  const filter = params.get("status") || "all";
  const source = currentScenario() === "partial" ? accountOrders().slice(0, 4) : accountOrders();
  const pending = order => order.financialStatus === "pending" && !["batal", "selesai"].includes(order.status);
  const visible = source.filter(order => (!selectedStore || order.storeSlug === selectedStore)
    && (!search || `${order.number} ${order.items.map(item => item.title).join(" ")}`.toLocaleLowerCase("id").includes(search.toLocaleLowerCase("id")))
    && (filter === "all" || (filter === "pending" ? pending(order) : filter === "active" ? ["baru", "diproses", "dikirim", "retur"].includes(order.status) : order.status === filter)))
    .sort((a, b) => Number(pending(b)) - Number(pending(a)));
  ordersReturnUrl = location.pathname + location.search;
  content.innerHTML = `${pageHeader("PESANAN LINTAS TOKO", "Pesanan Anda", "Pantau pesanan dan temukan langkah berikutnya.", '<button class="button secondary" data-action="claim" type="button">Cari pesanan saya</button>')}
    ${currentScenario() === "partial" ? partialNotice("Sebagian riwayat belum dimuat.") : ""}
    <form id="order-search" class="search-toolbar"><label>Cari pesanan<input name="q" type="search" value="${escapeHtml(search)}" placeholder="Nomor pesanan atau produk"></label>
    <label>Toko<select name="store" aria-label="Toko"><option value="">Semua toko</option>${Object.values(stores).map(store => `<option value="${store.slug}" ${selectedStore === store.slug ? "selected" : ""}>${store.name}</option>`).join("")}</select></label>
    <input type="hidden" name="status" value="${escapeHtml(filter)}"><button class="button secondary" type="submit">Cari</button></form>
    <div class="filter-row" role="group" aria-label="Status pesanan">${[["all","Semua"],["pending","Belum bayar"],["active","Aktif"],["selesai","Selesai"],["retur","Retur"],["batal","Dibatalkan"]].map(([value,label]) => `<button class="filter ${value === filter ? "is-active" : ""}" aria-pressed="${value === filter}" data-filter="${value}" type="button">${label}</button>`).join("")}</div>
    <p class="result-count" role="status">${visible.length} pesanan ditemukan</p>
    <div class="order-list">${visible.length ? visible.map(orderCard).join("") : '<section class="state-card"><h2>Tidak ada hasil</h2><p>Coba nomor pesanan, produk, atau toko lain.</p><a href="/orders" class="button secondary">Hapus filter</a></section>'}</div>`;
}
function nextOrderAction(order) {
  if (order.financialStatus === "pending") return ["Lanjutkan pembayaran", "payment"];
  if (order.status === "dikirim") return ["Lacak pengiriman", "tracking"];
  if (["diproses", "baru"].includes(order.status)) return ["Lihat perkembangan", "tracking"];
  if (order.status === "retur") return ["Lihat perkembangan retur", "help"];
  return ["Lihat bukti pesanan", "receipt"];
}

function renderOrderDetail(orderNumber) {
  const order = accountOrders().find(item => item.number === orderNumber);
  const store = storeForOrder(order);
  const [action, target] = nextOrderAction(order);
  const title = order.financialStatus === "pending" ? "Menunggu pembayaran" : orderStatusMeta[order.status].label;
  content.innerHTML = `<a class="detail-back" href="${escapeHtml(ordersReturnUrl)}">← Kembali ke pesanan</a>
    ${pageHeader("", title, `${store.name} · ${order.number} · ${order.displayDate}`)}
    <section class="order-overview" aria-label="Ringkasan dan tindakan pesanan">
      <div><span>Total pesanan</span><strong class="overview-total">${money(order.totalIdr)}</strong>${financialBadge(order)}</div>
      <div class="order-next"><a class="button primary" href="/orders/${order.number}/${target}">${action}</a><a href="/orders/${order.number}/help">Bantuan dari ${store.name}</a></div>
    </section>
    <nav class="order-links" aria-label="Rincian pesanan"><a href="/orders/${order.number}/payment">Pembayaran</a><a href="/orders/${order.number}/tracking">Pengiriman</a><a href="/orders/${order.number}/receipt">Bukti pesanan</a></nav>
    ${currentScenario() === "partial" ? partialNotice("Rincian terbaru belum tersedia. Informasi terakhir tetap ditampilkan.") : ""}
    <div class="detail-grid"><div class="stack"><section class="section-card"><h2>Produk</h2>
    ${order.items.map(item => `<div class="line-item">${productThumb(item,"large")}<div><strong>${displayProductTitle(item)}</strong><small>${item.qty} × ${money(item.priceIdr)}</small></div><strong>${money(item.totalIdr)}</strong></div>`).join("")}</section>
    <section class="section-card"><h2>Alamat pengiriman pesanan ini</h2><p>${order.shipRecipient} · ${formatPhoneId(order.shipPhone)}<br>${order.shipAddress}, ${order.city}, ${order.province} ${order.shipPostcode}</p><p class="field-help">Perubahan alamat tersimpan tidak mengubah alamat pesanan ini.</p></section></div>
    <section class="section-card"><h2>Rincian total</h2>${[["Subtotal",order.subtotalIdr],["Ongkir",order.shippingIdr],["Pajak",order.taxIdr]].map(([label,value])=>`<div class="summary-row"><span>${label}</span><strong>${money(value)}</strong></div>`).join("")}
    ${order.discountIdr ? `<div class="summary-row"><span>Diskon</span><strong>−${money(order.discountIdr)}</strong></div>` : ""}<div class="summary-row total"><span>Total</span><strong>${money(order.totalIdr)}</strong></div></section></div>`;
}

function renderOrderReceipt(orderNumber) {
  const order = accountOrders().find((item) => item.number === orderNumber);
  const store = storeForOrder(order);
  
  content.innerHTML = `<div class="page-header"><a href="/orders/${order.number}" class="back-link">← Kembali ke ikhtisar pesanan</a></div>
    ${pageHeader("BUKTI PESANAN", order.number, "Ringkasan resmi transaksi pesanan", `<button class="button secondary" type="button" onclick="window.print()">Cetak</button>`)}
    <div class="detail-grid receipt-view">
      <div class="stack">
        <section class="section-card">
          <div class="section-heading"><h2>Rincian Transaksi</h2></div>
          <div class="transaction-refs" style="margin-bottom: 24px;">
            <div><dt>Toko</dt><dd>${store.name}</dd></div>
            <div><dt>Tanggal Order</dt><dd>${order.displayDate}</dd></div>
            <div><dt>Status Pembayaran</dt><dd>${paymentStatusLabels[order.payment.status]}</dd></div>
          </div>
          
          <div class="section-heading"><h2>Produk</h2></div>
          ${order.items.map((item) => `<div class="line-item">${productThumb(item, "large")}<div><strong>${displayProductTitle(item)}</strong><small>${item.qty} × ${money(item.priceIdr)}</small></div><strong>${money(item.totalIdr)}</strong></div>`).join("")}
          
          <div style="margin-top: 24px; border-top: 1px solid var(--border); padding-top: 16px;">
            <div class="summary-row"><span>Subtotal</span><strong>${money(order.subtotalIdr)}</strong></div>
            <div class="summary-row"><span>Ongkos Kirim (${order.courier.toUpperCase()})</span><strong>${money(order.shippingIdr)}</strong></div>
            <div class="summary-row"><span>Pajak</span><strong>${money(order.taxIdr)}</strong></div>
            <div class="summary-row"><span>Diskon</span><strong>−${money(order.discountIdr)}</strong></div>
            <div class="summary-row total" style="margin-top: 16px; font-size: 1.1em;"><span>Total Tagihan</span><span>${money(order.totalIdr)}</span></div>
          </div>
        </section>
      </div>
    </div>`;
}

function renderOrderTracking(orderNumber) {
  const order = accountOrders().find((item) => item.number === orderNumber);
  
  content.innerHTML = `<div class="page-header"><a href="/orders/${order.number}" class="back-link">← Kembali ke ikhtisar pesanan</a></div>
    ${pageHeader("PELACAKAN", order.number, "Status pengiriman dan riwayat kurir", statusBadge(order))}
    <div class="detail-grid">
      <div class="stack">
        <section class="section-card">
          <div class="section-heading"><h2>Informasi Kurir</h2></div>
          <p class="lead"><strong>Kurir:</strong> ${courierLabels[order.courier] || order.courier} ${order.serviceType}</p>
          <p class="lead"><strong>Nomor resi:</strong> ${order.awb || "Belum tersedia"}${order.awb ? ` <button class="button secondary" type="button" data-copy-text="${order.awb}" data-copy-message="Nomor resi disalin!" style="display: inline-flex; vertical-align: middle; margin-left: 8px; padding: 2px 8px; font-size: 12px; min-height: 28px; height: 28px;">Salin resi</button>` : ''}</p>
        </section>
        <section class="section-card">
          <div class="section-heading"><h2>Riwayat Pengiriman</h2></div>
          <div class="timeline">
            ${order.timeline.map(([label, meta, done]) => `<div class="timeline-row ${done ? "done-step" : ""}"><span class="timeline-dot"></span><div><strong>${label}</strong><span>${meta}</span></div></div>`).join("")}
          </div>
        </section>
      </div>
      <div class="stack">
        <section class="section-card">
          <div class="section-heading"><h2>Tujuan Pengiriman</h2></div>
          <p class="lead">${order.shipRecipient}<br>${formatPhoneId(order.shipPhone)}<br>${order.shipAddress}<br>${order.city}, ${order.province} ${order.shipPostcode}</p>
        </section>
      </div>
    </div>`;
}

function renderOrderPayment(orderNumber) {
  const order = accountOrders().find(item => item.number === orderNumber);
  const pending = order.financialStatus === "pending";
  const mode = new URLSearchParams(location.search).get("payment") || "pending";
  const state = demo.payments?.[orderNumber] || (pending ? mode : "paid");
  const expired = state === "expired";
  const paid = state === "paid";
  const label = paid ? "Pembayaran diterima" : expired ? "Instruksi pembayaran kedaluwarsa" : "Selesaikan pembayaran";
  content.innerHTML = `<a class="detail-back" href="/orders/${order.number}">← Kembali ke pesanan</a>${pageHeader("PEMBAYARAN",label,`${storeForOrder(order).name} · ${order.number}`)}
    <section class="section-card payment-card"><span>Total pembayaran</span><strong class="overview-total">${money(order.payment.total)}</strong>
    ${pending ? paid ? '<p role="status">Pembayaran berhasil diverifikasi.</p>' : expired ? '<p>Instruksi pembayaran kedaluwarsa. Minta bantuan untuk memperbarui pembayaran pesanan ini.</p>' : `<p>Metode: ${paymentMethodLabels[order.payment.method]}. Batas waktu: 30 menit setelah instruksi dibuka.</p><div class="payment-demo"><strong>Instruksi Pembayaran</strong><p>Silakan selesaikan pembayaran sesuai nominal yang tertera. Klik tombol di bawah untuk verifikasi.</p>${order.payment.virtualAccount ? `<div style="margin-top: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;"><span>No. Virtual Account: <strong>${order.payment.virtualAccount}</strong></span><button class="button secondary" type="button" data-copy-text="${order.payment.virtualAccount}" data-copy-message="Nomor VA disalin!" style="padding: 2px 8px; font-size: 12px; min-height: 28px; height: 28px;">Salin VA</button></div>` : ''}</div><button class="button primary" data-action="payment" data-id="${order.number}" type="button">Simulasikan pembayaran</button>` : `<p>${financialStatusMeta[order.financialStatus].label}</p><p>Metode: ${paymentMethodLabels[order.payment.method]}</p>${order.payment.method === "cod" ? '<p>Pembayaran COD untuk pesanan ini sudah selesai. Tidak perlu membayar lagi.</p>' : ''}`}
    ${expired ? `<a class="button primary" href="/orders/${order.number}/help">Minta bantuan pembayaran</a>` : `<a class="payment-help" href="/orders/${order.number}/help">Pembayaran bermasalah?</a>`}
    </section>
    ${pending ? `<details class="demo-controls"><summary>Opsi status pembayaran</summary><nav class="order-links"><a href="/orders/${order.number}/payment?payment=pending">Menunggu</a><a href="/orders/${order.number}/payment?payment=expired">Kedaluwarsa</a><a href="/orders/${order.number}/payment?payment=delayed">Status terlambat</a></nav></details>` : ""}`;
  if (state === "delayed" && content.querySelector('.payment-demo')) { content.querySelector('.payment-demo').innerHTML = '<strong>Status belum diperbarui</strong><p>Jangan membayar lagi. Cek ulang status atau hubungi toko dengan nomor pesanan ini.</p>';content.querySelector('[data-action=payment]').textContent='Cek ulang status demo'; }
}
function renderOrderHelp(orderNumber) {
  const order = accountOrders().find(item => item.number === orderNumber);
  const requests = demo.requests.filter(item => item.order === orderNumber);
  content.innerHTML = `<a class="detail-back" href="/orders/${order.number}">← Kembali ke pesanan</a>${pageHeader("BANTUAN PESANAN",`Bantuan dari ${storeForOrder(order).name}`,order.number)}
    <section class="section-card"><h2>Apa yang bisa dibantu?</h2><p>Jelaskan masalah pesanan ini. Permintaan pembatalan atau retur akan ditinjau oleh pihak toko.</p><button class="button primary" data-action="help" data-id="${orderNumber}" type="button">Ajukan bantuan</button><p class="field-help">Pesan bantuan akan diteruskan ke tim toko.</p></section>
    <section class="section-card"><h2>Perkembangan permintaan</h2>${requests.length ? requests.map(item => `<article class="request-row"><strong>${escapeHtml(item.type)} · ${escapeHtml(item.id)}</strong><p>${escapeHtml(item.message)}</p><span class="badge processing">Menunggu peninjauan</span></article>`).join("") : '<p>Belum ada permintaan bantuan.</p>'}
    ${order.status === "retur" ? '<p>Permintaan retur sedang diproses oleh pihak toko.</p>' : ""}</section>`;
}

function renderAddresses() {
  const visible = currentScenario() === "partial" ? addresses.slice(0,1) : addresses;
  content.innerHTML = `${pageHeader("ALAMAT", "Alamat tersimpan", "Pilih alamat saat checkout. Pesanan lama tetap memakai alamat sebelumnya.", '<button class="button primary" data-action="address" type="button">Tambah alamat</button>')}
    ${currentScenario() === "partial" ? partialNotice("Sebagian alamat belum dimuat.") : ""}
    <div class="address-grid">${visible.map(address => `<article class="address-card"><div class="address-head"><h2>${escapeHtml(address.label)}</h2>${address.primary ? '<span class="badge connected">Utama</span>' : ""}</div><p><strong>${escapeHtml(address.recipient)}</strong><br>${escapeHtml(formatPhoneId(address.phone))}<br>${escapeHtml(address.addressLine)}<br>${escapeHtml(address.districtLabel)}, ${escapeHtml(address.city)} ${escapeHtml(address.postcode)}</p><div class="card-actions"><button data-action="address" data-id="${address.id}" type="button">Edit</button>${address.primary ? "" : `<button data-action="address-primary" data-id="${address.id}" type="button">Jadikan utama</button>`}<button class="danger-link" data-action="address-delete" data-id="${address.id}" type="button">Hapus</button></div></article>`).join("") || '<section class="state-card"><h2>Belum ada alamat tersimpan</h2><p>Tambahkan alamat atau isi alamat tamu saat checkout.</p></section>'}</div>`;
}

function renderStores() {
  const sourceOrders = currentScenario() === "partial" ? accountOrders().slice(0, 4) : accountOrders();
  const storeEntries = Object.entries(stores).filter(([, store]) => sourceOrders.some((order) => order.storeId === store.id));
  const storeCards = storeEntries.map(([key, store]) => {
    const storeOrders = sourceOrders.filter((order) => order.storeId === store.id);
    const latestOrder = storeOrders[0];
    const returnAction = `<a href="/stores/${store.slug}" class="button secondary full-width store-return-link">Lihat toko<span class="sr-only"> ${store.name}</span></a>`;
    return `<article class="store-history-card"><div class="store-history-heading"><span class="store-mark ${key} store-history-mark" aria-hidden="true">${store.short}</span><div><h2>${store.name}</h2><span>${store.category}</span></div></div><div class="store-order-context"><strong>Pesanan terakhir · ${latestOrder.displayDate}</strong><p>${displayProductTitle(latestOrder.items[0])}${latestOrder.items.length > 1 ? ` dan ${latestOrder.items.length - 1} lainnya` : ""}</p><p class="store-order-reference">${latestOrder.number}</p></div>${returnAction}</article>`;
  }).join("");
  content.innerHTML = `${pageHeader("RIWAYAT TOKO", "Toko tempat Anda berbelanja", "Temukan kembali toko dari riwayat pesanan Anda.")}${currentScenario() === "partial" ? partialNotice("Riwayat belanja sebagian toko belum dapat dimuat.") : ""}<div class="prototype-hint checkout-reuse-note"><strong>Checkout Lebih Cepat</strong><p>Gunakan kontak dan alamat tersimpan saat belanja di toko terhubung. Ongkir dan total belanja tetap dikonfirmasi sebelum pesanan dibuat.</p></div><div class="store-history-grid">${storeCards}</div>`;
}

function renderProfile() {
  if (renderScenarioState("profile")) return;
  const profile = demo.profile;
  content.innerHTML = `${pageHeader("AKUN", "Profil & keamanan", "Kelola kontak, perangkat, dan izin toko Anda.")}
    <div class="profile-grid"><div class="stack"><section class="section-card"><div class="section-heading"><h2>Informasi pribadi</h2><button class="link-button" data-action="profile" type="button">Edit profil</button></div><p><strong>${escapeHtml(profile.name)}</strong><br>${escapeHtml(formatPhoneId(profile.phone))}<br>${profile.email ? escapeHtml(profile.email) : "Email belum ditambahkan"}</p><button class="button secondary" data-action="phone" type="button">Ubah nomor HP</button></section>
    <section class="section-card"><h2>Keamanan dan perangkat</h2><p class="field-help">Daftar perangkat yang saat ini terhubung ke akun Anda.</p><div class="request-row"><strong>Browser ini</strong><span class="badge connected">Aktif</span></div>${demo.sessions.map(session => `<div class="request-row"><strong>${session.name}</strong><p>Terakhir aktif ${session.last}</p><button class="link-button" data-action="revoke" data-id="${session.id}" type="button">Keluarkan perangkat</button></div>`).join("")}
    ${demo.sessions.length ? '<button class="button secondary" data-action="revoke-all" type="button">Keluar dari perangkat lain</button>' : '<p role="status">Tidak ada perangkat lain yang aktif.</p>'}<button class="button secondary" data-action="recovery" type="button">Nomor lama tidak bisa diakses</button><button class="button destructive-row" id="profile-logout" type="button">Keluar dari akun</button></section>
    <section class="section-card"><h2>Alamat pengiriman</h2><p>${addresses.length} alamat tersimpan. Periksa alamat sebelum checkout.</p><a class="button secondary" href="/addresses">Kelola alamat</a></section></div>
    <div class="stack"><section class="section-card"><h2>Notifikasi</h2><label class="check-row"><input type="checkbox" data-preference="updates" ${demo.preferences.updates ? "checked" : ""}><span>Status pesanan via WhatsApp</span></label><label class="check-row"><input type="checkbox" data-preference="promos" ${demo.preferences.promos ? "checked" : ""}><span>Promo dari toko terhubung</span></label><p class="field-help">Atur saluran notifikasi pembaruan pesanan dan promo.</p></section>
    <section class="section-card"><h2>Toko terhubung</h2><p>Toko hanya menerima kontak dan alamat yang Anda pilih. Pesanan toko lain dan perangkat Anda tetap pribadi.</p>${demo.connections.map(key=>`<div class="connection-row"><strong>${stores[key].name}</strong><button class="link-button" data-action="disconnect" data-id="${key}" type="button">Putuskan</button></div>`).join("") || '<p>Belum ada toko terhubung.</p>'}${Object.keys(stores).filter(key=>!demo.connections.includes(key)).map(key=>`<div class="connection-row"><span>${stores[key].name} · Nonaktif</span><button class="link-button" data-action="connect" data-id="${key}" type="button">Hubungkan</button></div>`).join("")}<button class="button secondary" data-action="claim" type="button">Cari pesanan saya</button></section>
    ${renderCodTrustCard() ? `<details class="section-card"><summary>Status akses COD</summary>${renderCodTrustCard()}</details>` : ""}
    <section class="section-card"><h2>Data akun</h2><p>Kelola data profil dan privasi akun Anda.</p><button class="link-button" data-action="export" type="button">Minta salinan data</button><button class="link-button danger-link" data-action="closure" type="button">Ajukan penutupan akun</button>${demo.requests.filter(item=>!item.order).map(item=>`<article class="request-row"><strong>${escapeHtml(item.type)}</strong><p>${escapeHtml(item.id)} · Menunggu peninjauan</p></article>`).join("")}</section></div></div>`;
}

const districtFixtures = {
  "3171090": { label: "Kecamatan Tebet", city: "Jakarta Selatan", province: "DKI Jakarta", rates: { standard: { label: "SPX Standard (2-3 hari)", service: "spx", serviceType: "1", costIdr: 20000, codAllowed: true }, express: { label: "SPX Economy (3-5 hari)", service: "spx", serviceType: "3", costIdr: 16000, codAllowed: true } } },
  "3171100": { label: "Kecamatan Setiabudi", city: "Jakarta Selatan", province: "DKI Jakarta", rates: { standard: { label: "JNE Express Reguler (2-3 hari)", service: "jne", serviceType: "REG23", costIdr: 15000, codAllowed: false }, express: { label: "JNE Express YES (besok)", service: "jne", serviceType: "YES23", costIdr: 25000, codAllowed: false } } },
  "3273010": { label: "Kecamatan Bandung Kulon", city: "Bandung", province: "Jawa Barat", rates: { standard: { label: "J&T EZ (2-4 hari)", service: "jnt", serviceType: "EZ", costIdr: 22000, codAllowed: false }, express: { label: "J&T JND (1-2 hari)", service: "jnt", serviceType: "JND", costIdr: 38000, codAllowed: false } } },
};

const checkoutFixture = {
  sessionId: "e1111111-1111-4111-8111-111111111111",
  storeKey: "batik",
  items: [
    { handle: "dress-midi-motif-bunga", variant: "Navy / M", qty: 1 },
    { handle: "kemeja-oversized-wanita", variant: "Putih / L", qty: 1 },
  ],
  lines: [
    { handle: "dress-midi-motif-bunga", variant: "Navy / M", title: "Dress Midi Motif Bunga", variantLabel: "Navy / M", qty: 1, priceIdr: 189000 },
    { handle: "kemeja-oversized-wanita", variant: "Putih / L", title: "Kemeja Oversized Wanita", variantLabel: "Putih / L", qty: 1, priceIdr: 120000 },
  ],
  stalePriceIdr: 189000,
  correctedPriceIdr: 199000,
  taxIdr: 3000,
  discountIdr: 10000,
  discountCode: "KEMBALI10",
};

let checkoutState = {
  addressIndex: Math.max(0, addresses.findIndex(item=>item.primary)),
  shippingType: "standard",
  paymentChannel: "QRIS",
  guestMode: false,
  focusTarget: null,
  repriceConfirmed: false,
  simulation: null,
  guest: {
    name: "", phone: "", email: "", address: "", city: "", province: "", postcode: "", destId: "", shippingType: null, paymentChannel: null,
    touched: { name: false, phone: false, email: false, address: false, city: false, province: false, postcode: false, destId: false },
    valid: false, reviewRequired: false,
  },
};

function normalizeIndonesianPhone(value) {
  const digits = value.replace(/\D/g, "");
  const national = digits.startsWith("62") ? digits.slice(2) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^8\d{7,11}$/.test(national) ? `62${national}` : "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function validateGuest() {
  const guest = checkoutState.guest;
  const validation = {
    nameValid: guest.name.trim().replace(/\s/g, "").length >= 2,
    phoneValid: Boolean(normalizeIndonesianPhone(guest.phone)),
    emailValid: !guest.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email.trim()),
    addressValid: guest.address.trim().replace(/\s/g, "").length >= 12,
    cityValid: guest.city.trim().length >= 3,
    provinceValid: guest.province.trim().length >= 3,
    postcodeValid: /^\d{5}$/.test(guest.postcode.trim()),
    destIdValid: Boolean(districtFixtures[guest.destId]),
  };
  guest.valid = Object.values(validation).every(Boolean);
  return validation;
}

function checkoutAddress() {
  if (!checkoutState.guestMode) return addresses[checkoutState.addressIndex];
  const guest = checkoutState.guest;
  return {
    label: "Alamat tamu", recipient: guest.name.trim(), phone: normalizeIndonesianPhone(guest.phone), email: guest.email.trim(),
    addressLine: guest.address.trim(), city: guest.city.trim(), province: guest.province.trim(), postcode: guest.postcode.trim(),
    districtId: guest.destId, districtLabel: districtFixtures[guest.destId]?.label || "Kecamatan belum dipilih",
  };
}

window.renderCheckout = function() {
  if (!addresses.length) checkoutState.guestMode = true;
  const store = stores[checkoutFixture.storeKey];
  const validation = checkoutState.guestMode ? validateGuest() : null;
  const addressValid = checkoutState.guestMode ? checkoutState.guest.valid && !checkoutState.guest.reviewRequired : Boolean(addresses[checkoutState.addressIndex]?.districtId);
  const address = checkoutAddress() || {};
  const shippingType = checkoutState.guestMode ? checkoutState.guest.shippingType : checkoutState.shippingType;
  const paymentChannel = checkoutState.guestMode ? checkoutState.guest.paymentChannel : checkoutState.paymentChannel;
  const district = districtFixtures[address.districtId];
  const shippingQuote = addressValid && shippingType && district ? district.rates[shippingType] : null;
  const repriceActive = currentScenario() === "reprice";
  const lines = checkoutFixture.lines.map((line, index) => ({ ...line, priceIdr: repriceActive && index === 0 ? checkoutFixture.correctedPriceIdr : line.priceIdr }));
  const pricedLines = lines.map((line) => ({ ...line, totalIdr: line.priceIdr * line.qty }));
  const responseLines = lines.map((line) => ({ handle: line.handle, title: `${line.title}: ${line.variant}`, qty: line.qty, price: line.priceIdr }));
  const subtotal = pricedLines.reduce((sum, line) => sum + line.totalIdr, 0);
  const shippingIdr = shippingQuote?.costIdr || 0;
  const taxIdr = checkoutFixture.taxIdr;
  const discountIdr = checkoutFixture.discountIdr;
  const total = subtotal + shippingIdr + taxIdr - discountIdr;
  const oldSubtotal = subtotal - (repriceActive ? checkoutFixture.correctedPriceIdr - checkoutFixture.stalePriceIdr : 0);
  const oldTotal = oldSubtotal + shippingIdr + taxIdr - discountIdr;
  const paymentValid = Boolean(paymentChannel) && (paymentChannel !== "cod" || (shippingQuote?.codAllowed === true && codState.status !== "restricted"));
  const canSubmit = addressValid && Boolean(shippingQuote) && paymentValid;

  const addressOptions = addresses.map((item, index) => `<label class="radio-label"><input type="radio" name="address" value="${index}" id="address-${index}" ${checkoutState.addressIndex === index ? "checked" : ""}><div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.recipient)} · ${escapeHtml(item.addressLine)}, ${escapeHtml(item.districtLabel)}, ${escapeHtml(item.city)}, ${escapeHtml(item.province)} ${escapeHtml(item.postcode)}</span></div></label>`).join("");
  const shippingOptions = Object.entries(district?.rates || districtFixtures["3171090"].rates).map(([value, option]) => `<label class="radio-label"><input type="radio" name="shipping" value="${value}" id="shipping-${value}" ${shippingType === value ? "checked" : ""} ${!addressValid ? "disabled" : ""}><div><strong>${option.label}</strong><span>${option.service} ${option.serviceType} · ${money(option.costIdr)}</span></div></label>`).join("");
  const paymentOptions = [["QRIS", "QRIS"], ["VAMANDIRI", "Virtual Account Mandiri"], ["cod", "Bayar di tempat"]].map(([value, label]) => {
    let disabled = !addressValid;
    let note = "Kanal pembayaran simulasi";
    if (value === "cod") {
      if (shippingQuote?.codAllowed !== true) {
        disabled = true;
        note = "Tidak tersedia untuk layanan ini";
      } else if (codState.status === 'restricted') {
        disabled = true;
        note = "Dinonaktifkan sementara (Batas penolakan COD)";
      }
    }
    return `<label class="radio-label"><input type="radio" name="payment" value="${value}" id="payment-${value}" ${paymentChannel === value ? "checked" : ""} ${disabled ? "disabled" : ""}><div><strong>${label}</strong><span>${note}</span></div></label>`;
  }).join("");
  
  const checkoutTrustCard = codState.status === "normal" ? "" : codState.status === 'restricted' 
    ? `<div class="privacy-note" style="border-left-color: var(--destructive); margin-bottom: 24px;"><strong>Metode COD dinonaktifkan.</strong> Anda memiliki ${codState.verifiedRefusals} penolakan COD dalam ${codState.windowDays} hari terakhir. Silakan gunakan metode prabayar.</div>`
    : `<div class="privacy-note" style="border-left-color: var(--warning-dark, #b45309); margin-bottom: 24px;"><strong>Peringatan COD.</strong> Anda memiliki ${codState.verifiedRefusals} dari ${codState.threshold} batas penolakan COD. Satu penolakan lagi akan menonaktifkan fitur COD Anda sementara.</div>`;
  
  const error = (field, valid, message) => checkoutState.guest.touched[field] && !valid ? `<p class="login-error" id="guest-${field}-error">${message}</p>` : "";
  const invalidAttrs = (field, valid) => checkoutState.guest.touched[field] && !valid ? `aria-invalid="true" aria-describedby="guest-${field}-error"` : "";

  const completion = checkoutState.simulation ? `<section class="section-card" role="status" aria-live="polite"><div class="section-heading"><h2>Simulasi selesai</h2><span class="badge connected">Tidak ditulis</span></div><p class="lead"><strong>Ini hanya simulasi.</strong> Tidak ada pesanan, pembayaran, akun, atau alamat yang ditulis ke backend.</p><div class="summary-row"><span>Nomor simulasi</span><strong>${checkoutState.simulation.response.orderNumber}</strong></div><div class="summary-row"><span>Subtotal respons</span><strong>${money(checkoutState.simulation.response.subtotal)}</strong></div><div class="summary-row"><span>Ongkir respons</span><strong>${money(checkoutState.simulation.response.shipping)}</strong></div><div class="summary-row"><span>Pajak respons</span><strong>${money(checkoutState.simulation.response.tax)}</strong></div><div class="summary-row"><span>Diskon respons</span><strong>−${money(checkoutState.simulation.response.discount)}</strong></div><div class="summary-row total"><span>Total respons</span><span>${money(checkoutState.simulation.response.total)}</span></div><details><summary>Permintaan simulasi yang dinormalisasi</summary><pre>${escapeHtml(JSON.stringify(checkoutState.simulation.request, null, 2))}</pre></details><details><summary>Respons simulasi berbentuk respons server</summary><pre>${escapeHtml(JSON.stringify(checkoutState.simulation.response, null, 2))}</pre></details></section>` : "";

  content.innerHTML = `<div style="margin-bottom:24px"><button class="link-button" type="button" data-route="stores">← Kembali ke Toko</button></div>
    ${pageHeader(`CHECKOUT · ${store.name.toUpperCase()}`, "Tinjau pesanan", checkoutState.guestMode ? "Lengkapi data pengiriman Anda di bawah." : "Periksa kontak dan alamat pengiriman Anda sebelum melanjutkan.")}
    ${repriceActive ? `<div class="privacy-note" role="alert"><strong>Harga berubah.</strong> Harga Dress Midi dikoreksi dari ${money(checkoutFixture.stalePriceIdr)} menjadi ${money(checkoutFixture.correctedPriceIdr)}. Total lama ${money(oldTotal)} tidak digunakan; konfirmasi total baru ${money(total)} sebelum simulasi.</div>` : ""}
    ${checkoutTrustCard}
    <div class="detail-grid"><div class="stack">
      ${!checkoutState.guestMode ? `<section class="section-card"><div class="section-heading"><h2>Kontak & alamat</h2></div><p class="lead"><strong>Penerima:</strong> ${escapeHtml(address.recipient)}<br><strong>Telepon:</strong> ${formatPhoneId(address.phone)}<br><strong>Email opsional:</strong> ${escapeHtml(address.email || "Tidak diisi")}</p><fieldset><legend>Kirim ke</legend>${addressOptions}</fieldset><p class="lead"><strong>Kecamatan tujuan:</strong> ${escapeHtml(address.districtLabel)}</p><button class="link-button" id="switch-guest-mode" type="button">Checkout sebagai tamu</button></section>` : `
      <section class="section-card"><div class="section-heading"><h2>Mode tamu</h2><span class="badge warning">Tamu</span></div><p class="lead">Belanja sebagai tamu tanpa perlu login.</p><button class="button secondary" id="return-account-checkout" type="button">${!demo.signedIn ? "Masuk untuk memakai alamat akun" : addresses.length ? "Gunakan alamat akun" : "Tambah alamat akun"}</button></section>
      <section class="section-card"><div class="section-heading"><h2>Kontak & alamat lengkap</h2></div><fieldset><legend class="sr-only">Data checkout tamu</legend>
        <label class="login-label" for="guest-name">Nama penerima</label><input class="login-input" id="guest-name" autocomplete="name" value="${escapeHtml(checkoutState.guest.name)}" ${invalidAttrs("name", validation.nameValid)}>${error("name", validation.nameValid, "Masukkan nama penerima.")}
        <label class="login-label" for="guest-phone">Nomor HP Indonesia</label><input class="login-input" type="tel" id="guest-phone" autocomplete="tel" inputmode="tel" placeholder="081234567890" value="${escapeHtml(checkoutState.guest.phone)}" ${invalidAttrs("phone", validation.phoneValid)}>${error("phone", validation.phoneValid, "Masukkan nomor Indonesia yang valid.")}
        <label class="login-label" for="guest-email">Email (opsional)</label><input class="login-input" type="email" id="guest-email" autocomplete="email" value="${escapeHtml(checkoutState.guest.email)}" ${invalidAttrs("email", validation.emailValid)}>${error("email", validation.emailValid, "Format email belum valid.")}
        <label class="login-label" for="guest-address">Alamat lengkap</label><textarea class="login-input" id="guest-address" autocomplete="street-address" rows="3" ${invalidAttrs("address", validation.addressValid)}>${escapeHtml(checkoutState.guest.address)}</textarea>${error("address", validation.addressValid, "Masukkan alamat lengkap minimal 12 karakter.")}
        <label class="login-label" for="guest-city">Kota/kabupaten</label><input class="login-input" id="guest-city" autocomplete="address-level2" value="${escapeHtml(checkoutState.guest.city)}" ${invalidAttrs("city", validation.cityValid)}>${error("city", validation.cityValid, "Masukkan kota atau kabupaten.")}
        <label class="login-label" for="guest-province">Provinsi</label><input class="login-input" id="guest-province" autocomplete="address-level1" value="${escapeHtml(checkoutState.guest.province)}" ${invalidAttrs("province", validation.provinceValid)}>${error("province", validation.provinceValid, "Masukkan provinsi.")}
        <label class="login-label" for="guest-postcode">Kode pos</label><input class="login-input" id="guest-postcode" autocomplete="postal-code" inputmode="numeric" maxlength="5" value="${escapeHtml(checkoutState.guest.postcode)}" ${invalidAttrs("postcode", validation.postcodeValid)}>${error("postcode", validation.postcodeValid, "Kode pos harus 5 digit.")}
        <label class="login-label" for="guest-destId">Kecamatan tujuan</label><select class="login-input" id="guest-destId" ${invalidAttrs("destId", validation.destIdValid)}><option value="">Pilih kecamatan</option>${Object.entries(districtFixtures).map(([id, item]) => `<option value="${id}" ${checkoutState.guest.destId === id ? "selected" : ""}>${escapeHtml(item.label)} · ${id}</option>`).join("")}</select>${error("destId", validation.destIdValid, "Pilih kecamatan tujuan agar ongkir dapat dihitung.")}
      </fieldset><button class="button secondary" id="review-guest-address" type="button">Tinjau alamat dan ongkir</button></section>`}
      <section class="section-card"><div class="section-heading"><h2>Pengiriman</h2></div>${!addressValid ? '<p class="lead">Lengkapi alamat valid sebelum memilih pengiriman.</p>' : ""}<fieldset><legend class="sr-only">Pilih layanan pengiriman</legend>${shippingOptions}</fieldset></section>
      <section class="section-card"><div class="section-heading"><h2>Pembayaran</h2></div>${!addressValid ? '<p class="lead">Lengkapi alamat valid sebelum memilih pembayaran.</p>' : ""}<fieldset><legend class="sr-only">Pilih kanal pembayaran</legend>${paymentOptions}</fieldset></section>
    </div><div class="stack"><section class="section-card"><div class="section-heading"><h2>Ringkasan</h2></div><div aria-live="polite" class="sr-only">Total simulasi ${canSubmit ? money(total) : "belum dapat dihitung"}.</div><p class="privacy-note"><strong>Jaminan Harga & Ongkir:</strong> Ongkir dan total pesanan dihitung otomatis berdasarkan alamat tujuan dan ketersediaan promo toko.</p>${pricedLines.map((line) => `<div class="line-item">${productThumb(line)}<div><strong>${line.title}</strong><small>${line.variantLabel} · ${line.qty} × ${money(line.priceIdr)}</small></div><strong>${money(line.totalIdr)}</strong></div>`).join("")}<div class="summary-row"><span>Subtotal</span><strong>${money(subtotal)}</strong></div><div class="summary-row"><span>Ongkir</span><strong>${shippingQuote ? money(shippingIdr) : "Belum dipilih"}</strong></div><div class="summary-row"><span>Pajak</span><strong>${money(taxIdr)}</strong></div><div class="summary-row"><span>Diskon</span><strong>−${money(discountIdr)}</strong></div><div class="checkout-footer"><div class="summary-row total"><span>Total pembayaran</span><span>${canSubmit ? money(total) : "Belum dihitung"}</span></div><button class="button primary full-width" id="place-demo-order" type="button" ${!canSubmit ? "disabled" : ""}>${!canSubmit ? "Lengkapi alamat, pengiriman & pembayaran" : repriceActive && !checkoutState.repriceConfirmed ? "Konfirmasi total baru" : "Simulasikan pesanan"}</button></div></section>
      <div class="privacy-note"><strong>Pratinjau:</strong> Halaman ini adalah demo interaktif alur checkout TokoPhi.</div>${completion}
    </div></div>`;

  const bindRadio = (name, handler) => document.querySelectorAll(`input[name="${name}"]`).forEach((radio) => radio.addEventListener("change", (event) => { handler(event.target.value); checkoutState.repriceConfirmed = false; checkoutState.simulation = null; checkoutState.focusTarget = event.target.id; renderCheckout(); }));
  if (!checkoutState.guestMode) {
    bindRadio("address", (value) => checkoutState.addressIndex = Number(value));
    bindRadio("shipping", (value) => checkoutState.shippingType = value);
    bindRadio("payment", (value) => checkoutState.paymentChannel = value);
    document.querySelector("#switch-guest-mode").addEventListener("click", () => { checkoutState.guestMode = true; checkoutState.focusTarget = "guest-name"; renderCheckout(); });
  } else {
    bindRadio("shipping", (value) => checkoutState.guest.shippingType = value);
    bindRadio("payment", (value) => checkoutState.guest.paymentChannel = value);
    document.querySelector("#return-account-checkout").addEventListener("click", () => {
      if (!demo.signedIn) { history.pushState(null,'','/?flow=checkout');renderRoute();return; }
      if (!addresses.length) { history.pushState(null,'','/addresses');renderRoute();return; }
      checkoutState.guestMode = false; checkoutState.focusTarget = "switch-guest-mode"; renderCheckout();
    });
    ["name", "phone", "email", "address", "city", "province", "postcode"].forEach((field) => {
      const input = document.querySelector(`#guest-${field}`);
      input.addEventListener("input", (event) => {
        checkoutState.guest[field] = event.target.value;
        checkoutState.guest.reviewRequired = true;
        checkoutState.guest.shippingType = null;
        checkoutState.guest.paymentChannel = null;
        checkoutState.simulation = null;
        const submit = document.querySelector('#place-demo-order');
        submit.disabled = true; submit.textContent = 'Tinjau kembali alamat dan ongkir';
        document.querySelectorAll('input[name=shipping], input[name=payment]').forEach(el=>{el.disabled=true;el.checked=false});
        event.target.removeAttribute('aria-invalid');
        document.querySelector(`#guest-${field}-error`)?.remove();
      });
    });
    document.querySelector('#review-guest-address').addEventListener('click', () => {
      Object.keys(checkoutState.guest.touched).forEach(field=>checkoutState.guest.touched[field]=true);
      checkoutState.guest.reviewRequired = false;
      const validation = validateGuest();
      const invalid = Object.entries(validation).find(([,valid])=>!valid);
      checkoutState.focusTarget = invalid ? `guest-${invalid[0].replace('Valid','')}` : 'shipping-standard';
      renderCheckout();
    });
    document.querySelector("#guest-destId").addEventListener("change", (event) => {
      const selected = districtFixtures[event.target.value];
      checkoutState.guest.destId = event.target.value;
      checkoutState.guest.touched.destId = true;
      checkoutState.guest.city = selected?.city || checkoutState.guest.city;
      checkoutState.guest.province = selected?.province || checkoutState.guest.province;
      checkoutState.guest.shippingType = null;
      checkoutState.guest.paymentChannel = null;
      checkoutState.focusTarget = "guest-destId";
      renderCheckout();
    });
  }

  document.querySelector("#place-demo-order").addEventListener("click", () => {
    if (!canSubmit || (checkoutState.guestMode && checkoutState.guest.reviewRequired)) {
      if (checkoutState.guestMode) Object.keys(checkoutState.guest.touched).forEach((field) => checkoutState.guest.touched[field] = true);
      renderCheckout();
      return;
    }
    if (repriceActive && !checkoutState.repriceConfirmed) {
      checkoutState.repriceConfirmed = true;
      checkoutState.focusTarget = "place-demo-order";
      renderCheckout();
      return;
    }
    const request = {
      storeSlug: store.slug,
      sessionId: checkoutFixture.sessionId,
      items: lines.map(({ handle, variant, title, qty, priceIdr }) => ({ handle, name: title, price: priceIdr, variant, qty })),
      customer: { name: address.recipient, phone: normalizeIndonesianPhone(address.phone), email: address.email || undefined },
      address: { alamat: address.addressLine, kota: address.city, provinsi: address.province, kodepos: address.postcode },
      shipping: { label: shippingQuote.label, service: shippingQuote.service, serviceType: shippingQuote.serviceType, destId: Number(address.districtId) },
      channelCode: paymentChannel,
      discountCode: checkoutFixture.discountCode,
    };
    const response = {
      ok: true,
      orderNumber: "PHI-202963421A7K",
      subtotal,
      lines: responseLines,
      shipping: shippingIdr,
      tax: taxIdr,
      discount: discountIdr,
      total,
      tracking: null,
    };
    if (paymentChannel === "cod") {
      response.cod = true;
    } else {
      const isQris = paymentChannel === "QRIS";
      response.payment = {
        channel: { code: paymentChannel, label: isQris ? "QRIS" : "Virtual Account Mandiri", kind: isQris ? "qris" : "va" },
        virtualAccount: isQris ? null : "88081234567890",
        qr: isQris ? "fixture-qr-payload-not-rendered" : null,
        paymentCode: null,
        url: null,
        amount: total,
        admin: 0,
        total,
      };
    }
    checkoutState.simulation = { request, response };
    checkoutState.focusTarget = "place-demo-order";
    showToast("Simulasi selesai. Tidak ada pesanan atau pembayaran yang ditulis.");
    renderCheckout();
  });

  if (checkoutState.focusTarget) {
    document.getElementById(checkoutState.focusTarget)?.focus();
    checkoutState.focusTarget = null;
  }
};

function updateNavigation(route) {
  let baseRoute = route.startsWith("order") ? "orders" : route;
  if (route.startsWith("store/")) baseRoute = "stores";
  if (route === "notifications") baseRoute = null;
  
  document.body.classList.toggle("checkout-focus", route === "checkout");
  
  document.querySelectorAll("[data-route]").forEach((btn) => {
    if (btn.dataset.route) {
      const isActive = btn.dataset.route === baseRoute;
      if (btn.classList.contains("avatar-button") || btn.classList.contains("icon-button")) {
         // don't toggle is-active for topbar actions the same way, or just let them be
         if (btn.dataset.route === "profile") btn.classList.toggle("is-active", route === "profile");
         if (btn.dataset.route === "notifications") btn.classList.toggle("is-active", route === "notifications");
      } else {
        btn.classList.toggle("is-active", isActive);
      }
      if (isActive) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    }
  });
}

window.renderNotifications = function() {
  const scenario = currentScenario();
  if (scenario === "loading") {
    content.innerHTML = `<div class="skeleton-group" role="status" aria-live="polite" aria-busy="true"><div class="skeleton-block"></div><div class="skeleton-block"></div><div class="skeleton-block"></div></div>`;
    return;
  }
  if (scenario === "error") {
    content.innerHTML = `<section class="state-card" role="alert"><h2>Terjadi kendala</h2><p>Gagal memuat notifikasi.</p><button class="button primary" type="button" data-retry-scenario>Coba lagi</button></section>`;
    return;
  }
  
  const displayNotifs = scenario === "empty" ? [] : scenario === "partial" ? notifications.slice(0, 3) : notifications;
  
  let html = pageHeader("NOTIFIKASI", "Pusat Notifikasi", "Pembaruan pesanan dan informasi dari toko Anda.");
  if (scenario === "partial") html += partialNotice("Notifikasi lebih lama belum dimuat.");
  
  if (displayNotifs.length === 0) {
    html += `<section class="state-card" role="status"><h2>Belum ada notifikasi</h2><p>Aktivitas pesanan atau promo dari toko akan muncul di sini.</p></section>`;
  } else {
    const unreadCount = displayNotifs.filter(n => !n.isRead).length;
    
    html += `<div class="notification-actions"><button type="button" id="mark-all-read" class="link-button" ${unreadCount === 0 ? "disabled" : ""}>Tandai semua dibaca</button></div>`;
    html += `<div class="notification-list">`;
    displayNotifs.forEach(n => {
      html += `
        <a href="${n.route}" class="notification-row ${n.isRead ? "is-read" : ""}" data-notif-id="${n.id}">
          <div class="notification-icon">
            ${n.type === "promo" ? '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>' : '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>'}
          </div>
          <div class="notification-content">
            <strong>${n.title}</strong>
            <p>${n.body}</p>
            <span>${n.date}</span>
          </div>
          ${!n.isRead ? '<span class="unread-dot" aria-label="Belum dibaca"></span>' : ''}
        </a>
      `;
    });
    html += `</div>`;
  }
  content.innerHTML = html;
};

window.renderStoreProfile = function(storeKey) {
  const store = stores[storeKey];
  if (!store) {
    history.pushState(null, "", "/stores");
    renderRoute();
    return;
  }
  
  const scenario = currentScenario();
  if (scenario === "loading") {
    content.innerHTML = `<div class="skeleton-group" role="status" aria-live="polite" aria-busy="true"><div class="skeleton-block"></div><div class="skeleton-block"></div><div class="skeleton-block"></div></div>`;
    return;
  }
  if (scenario === "error") {
    content.innerHTML = `<section class="state-card" role="alert"><h2>Terjadi kendala</h2><p>Gagal memuat profil toko.</p><button class="button primary" type="button" data-retry-scenario>Coba lagi</button></section>`;
    return;
  }
  if (scenario === "empty") {
    content.innerHTML = `<div class="page-header"><a href="/stores" class="back-link" aria-label="Kembali ke Toko">← Kembali</a></div>${pageHeader("PROFIL TOKO", store.name, "Informasi toko")}<section class="state-card" role="status"><h2>Belum ada data toko</h2><p>Profil, voucher, dan pesanan toko belum tersedia saat ini.</p></section>`;
    return;
  }

  let html = `<div class="page-header"><a href="/stores" class="back-link" aria-label="Kembali ke Toko">← Kembali</a></div>`;
  
  html += `
    <div class="store-profile-hero">
      <div class="store-mark ${storeKey}" aria-hidden="true">${store.short}</div>
      <div class="store-profile-hero-text">
        <h1>${store.name}</h1>
        <span>${store.category}</span>
      </div>
      ${store.available && store.storefrontUrl ? `<a href="${store.storefrontUrl}" target="_blank" rel="noopener noreferrer" class="button primary">Kunjungi toko</a>` : ''}
    </div>
  `;
  if (scenario === "partial") html += partialNotice("Menampilkan sebagian voucher dan pesanan terbaru.");
  
  if (!store.available) {
    html += `
      <div class="store-unavailable-state">
        <p>${store.unavailableReason}</p>
      </div>
    `;
  } else {
    const vouchers = activeVouchersForStore(storeKey);
    const visibleVouchers = scenario === "partial" ? vouchers.slice(0, 1) : vouchers;
    if (visibleVouchers.length > 0) {
      html += `
        <section class="store-vouchers-section">
          <div class="store-section-heading">
            <h2>Voucher aktif</h2>
            <p class="prototype-hint">Kode voucher berlaku di ${store.name}. Potongan akhir dihitung saat checkout berdasarkan isi keranjang dan ketersediaan promo.</p>
          </div>
          <div class="store-voucher-list">
      `;
      visibleVouchers.forEach((voucher) => {
        html += `
          <div class="store-voucher-card">
            <div class="store-voucher-info">
              <strong>${voucherValueLabel(voucher)}</strong>
              ${voucher.minPurchaseIdr > 0 ? `<p>Min. belanja ${money(voucher.minPurchaseIdr)}</p>` : ""}
              ${voucher.endsAt ? `<span class="store-voucher-expiry">Berlaku s.d. ${new Date(voucher.endsAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</span>` : ""}
            </div>
            <div class="store-voucher-action">
              <span class="store-voucher-code">${voucher.code}</span>
              <button type="button" class="button secondary" data-copy-code="${voucher.code}">Salin kode</button>
            </div>
          </div>
        `;
      });
      html += `</div></section>`;
    }
  }
  
  // Recent orders
  const storeOrders = (scenario === "partial" ? accountOrders().slice(0, 1) : accountOrders()).filter((order) => order.storeId === store.id);
  html += `
    <section class="store-orders-section">
      <h2 class="store-orders-heading">Pesanan Anda di sini</h2>
  `;
  if (storeOrders.length === 0) {
    html += `<p>Belum ada pesanan dari toko ini.</p>`;
  } else {
    html += `<div class="store-order-list">`;
    storeOrders.forEach(order => {
      html += `
        <a href="/orders/${order.number}" class="store-order-row-link">
          <article class="store-order-row">
            <div class="store-order-row-header">
              <div class="store-order-row-meta">
                <strong>${order.displayDate}</strong>
                <span>${order.number}</span>
              </div>
              ${statusBadge(order)}
            </div>
            <div class="store-order-row-body">
              ${productThumb(order.items[0], "large")}
              <div class="store-order-row-summary">
                <strong class="store-order-row-title">${displayProductTitle(order.items[0])}</strong>
                <span class="store-order-row-qty">${order.items[0].qty} barang</span>
                ${order.items.length > 1 ? `<span class="store-order-row-more">+ ${order.items.length - 1} barang lainnya</span>` : ""}
              </div>
              <div class="store-order-row-total">
                <span>Total belanja</span>
                <strong>${money(order.totalIdr)}</strong>
              </div>
            </div>
          </article>
        </a>
      `;
    });
    html += `</div>`;
  }
  html += `</section>`;
  
  content.innerHTML = html;
};

function renderRoute() {
  let path = location.pathname.replace(/\/$/, "") || "/";
  if (path === "/profile") { history.replaceState(null, "", "/account" + location.search); path = "/account"; }
  const guestCheckout = path === '/checkout' && new URLSearchParams(location.search).get('guest') === '1';
  if (!demo.signedIn && !guestCheckout) { buyerShell.hidden = true; loginShell.hidden = false; document.body.classList.remove('checkout-focus'); return; }
  if (guestCheckout) checkoutState.guestMode = true;
  buyerShell.hidden = false; loginShell.hidden = true;
  if (path === "/" || path === "/index.html") { history.replaceState(null,"","/orders" + location.search); path = "/orders"; }
  const parts = path.split("/").filter(Boolean);
  const detail = parts[0] === "orders" && parts.length >= 2;
  const order = detail && accountOrders().find(item => item.number === parts[1]);
  const storeKey = parts[0] === "stores" && parts[1] && Object.keys(stores).find(key => stores[key].slug === parts[1]);
  const route = parts[0] === "account" ? "profile" : parts[0] === "dashboard" ? "dashboard" : parts[0];
  const known = ["dashboard","orders","stores","addresses","profile","notifications","checkout"].includes(route);
  const validDetail = !detail || (order && parts.length <= 3 && (!parts[2] || ["tracking","payment","receipt","help"].includes(parts[2])));
  const validStore = parts[0] !== "stores" || (parts.length === 1 || (parts.length === 2 && storeKey));
  updateNavigation(route);
  if (!known || !validDetail || !validStore || (!detail && parts[0] !== "stores" && parts.length > 1)) {
    content.innerHTML = `${pageHeader("HALAMAN TIDAK DITEMUKAN", "Data ini tidak tersedia", "Tautan mungkin tidak berlaku atau pesanan belum terhubung ke akun Anda.")}<a class="button primary" href="/orders">Kembali ke pesanan</a><button class="button secondary" data-action="claim" type="button">Cari pesanan saya</button>`;
  } else if (route !== "checkout" && renderScenarioState(route)) {
    // The state owns the whole content; never substitute the first order.
  } else if (detail) {
    const renderers = { tracking: renderOrderTracking, payment: renderOrderPayment, receipt: renderOrderReceipt, help: renderOrderHelp };
    (renderers[parts[2]] || renderOrderDetail)(order.number);
  } else if (storeKey) renderStoreProfile(storeKey);
  else if (route === "dashboard") renderDashboard();
  else if (route === "orders") renderOrders();
  else if (route === "addresses") renderAddresses();
  else if (route === "stores") renderStores();
  else if (route === "profile") renderProfile();
  else if (route === "notifications") renderNotifications();
  else renderCheckout();
  document.title = `${content.querySelector("h1")?.textContent || "Akun"} · TokoΦ`;
  document.querySelector("#route-status").textContent = `${content.querySelector("h1")?.textContent || "Halaman"} dimuat.`;
  content.focus({ preventScroll: true });
}

function renderMerchant(storeKey = "batik") {
  const store = stores[storeKey];
  const customer = tenantCustomers[storeKey];
  const ownOrders = orders.filter((order) => order.storeId === customer.storeId);
  const latest = ownOrders[0];
  merchantContent.innerHTML = `<div class="admin-wrap">
    <p class="admin-breadcrumb">Pelanggan / ${customer.id}</p>
    <div class="admin-titlebar"><div><div class="admin-title-row"><h1>Sari Andini</h1><span class="badge indigo">Akun terhubung</span><span class="badge ${customer.segment === "Baru" ? "connected" : "shipped"}">${customer.segment}</span></div><p class="lead">Data pelanggan di toko ${store.name}</p></div><button class="button secondary" type="button" data-demo-action="Kirim WhatsApp dari ${store.name}">Kirim WhatsApp</button></div>
    <div class="admin-grid"><div class="stack">
      <section class="admin-card"><div class="admin-stats"><div class="admin-stat"><span>Total belanja</span><strong>${money(customer.metrics.spentIdr)}</strong></div><div class="admin-stat"><span>Jumlah pesanan</span><strong>${customer.metrics.orderCount}</strong></div><div class="admin-stat"><span>Rata-rata</span><strong>${money(Math.round(customer.metrics.spentIdr / customer.metrics.orderCount))}</strong></div><div class="admin-stat"><span>Terakhir belanja</span><strong>${customer.last}</strong></div></div></section>
      <section class="admin-card"><div class="admin-card-header"><h3>Pesanan di ${store.name}</h3></div><div class="admin-card-body">${ownOrders.map((order) => `<div class="admin-order"><div><strong>${order.number}</strong><span>${order.displayDate} · ${displayProductTitle(order.items[0])}</span></div><div class="admin-order-value"><strong>${money(order.totalIdr)}</strong>${statusBadge(order)}</div></div>`).join("")}</div></section>
      <section class="admin-card"><div class="admin-card-header"><h3>Catatan merchant</h3></div><div class="admin-card-body"><p class="lead">${customer.notes}</p><button class="button secondary" type="button" data-demo-action="Edit catatan ${store.name}">Edit catatan</button></div></section>
    </div><div class="stack">
      <section class="admin-card"><div class="admin-card-header"><h3>Informasi customer toko ini</h3></div><div class="admin-card-body customer-meta"><div><span>ID customer</span><strong>${customer.id}</strong></div><div><span>Nama</span><strong>Sari Andini</strong></div><div><span>Telepon</span><strong>+62 812-3456-7890 · Terverifikasi</strong></div><div><span>Mulai menjadi customer</span><strong>${customer.joined}</strong></div><div><span>Snapshot alamat order terakhir</span><strong>${latest.shipAddress}, ${latest.city}, ${latest.province} ${latest.shipPostcode}</strong></div></div></section>
      <div class="boundary-card"><strong>Privasi Pelanggan: ${store.name}</strong><p>Toko ini hanya memiliki akses ke ${ownOrders.length} riwayat pesanan yang dilakukan di ${store.name}. Data pesanan toko lain tetap terpisah dan aman.</p></div>
      <section class="admin-card"><div class="admin-card-header"><h3>Tidak tersedia untuk merchant</h3></div><div class="admin-card-body"><p class="lead">Toko lain · order lintas toko · alamat tersimpan lain · perangkat/sesi · total lintas toko · recovery akun.</p></div></section>
    </div></div>
  </div>`;
  merchantContent.focus({ preventScroll: true });
}

// All mutations below are tab-local fixture changes. No fetch, OTP delivery or payment call.
const flowDialog = document.querySelector('#flow-dialog');
function syncIdentity() {
  document.querySelector('.identity-card strong').textContent = demo.profile.name;
  document.querySelector('.identity-card div > span').textContent = formatPhoneId(demo.profile.phone);
  const initials = demo.profile.name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  document.querySelectorAll('.identity-card .avatar, .avatar-button').forEach(el => el.textContent = initials);
  document.querySelector('.avatar-button').setAttribute('aria-label', `Buka akun ${demo.profile.name}`);
  document.querySelector('.nav-count').textContent = String(accountOrders().length);
  document.querySelector('.nav-count').setAttribute("aria-label", `${accountOrders().length} pesanan`);
}
function openForm(title, body, submitLabel, onSave) {
  const opener = document.activeElement;
  let simulateFailure = new URLSearchParams(location.search).get('save') === 'error';
  flowDialog.innerHTML = `<form class="local-form"><div class="section-heading"><h2 id="flow-title">${title}</h2><button class="icon-button" type="button" data-close-dialog aria-label="Tutup dialog">×</button></div>
    ${body}
    <p id="flow-error" class="login-error" role="alert" hidden></p>
    <div class="dialog-actions"><button class="button secondary" data-close-dialog type="button">Batal</button><button class="button primary" type="submit">${submitLabel}</button></div></form>`;
  const form = flowDialog.querySelector('form');
  flowDialog.onclose = () => { if (opener?.isConnected) opener.focus(); else content.focus({preventScroll:true}); };
  flowDialog.querySelectorAll('[data-close-dialog]').forEach(button=>button.onclick=()=>flowDialog.close());
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    const error = form.querySelector('#flow-error');
    if (button.disabled) return;
    error.hidden = true;
    form.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
    button.disabled = true; button.textContent = 'Menyimpan…';
    await new Promise(resolve=>setTimeout(resolve,180));
    if (!flowDialog.open || flowDialog.querySelector('form') !== form) return;
    let result;
    if (simulateFailure) { simulateFailure = false; result = {error:'Perubahan belum tersimpan. Isian tetap ada; silakan coba lagi.'}; }
    else result = onSave(new FormData(form));
    if (result?.error) {
      error.textContent = result.error; error.hidden = false;
      button.disabled = false; button.textContent = submitLabel;
      const field = result.field ? form.elements.namedItem(result.field) : error;
      field.setAttribute('tabindex','-1');
      if (result.field) { field.setAttribute('aria-invalid','true'); field.setAttribute('aria-describedby','flow-error'); field.removeAttribute('tabindex'); }
      field.focus(); return;
    }
    if (currentScenario() === 'empty') { const params=new URLSearchParams(location.search);params.delete('scenario');history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')); }
    const persisted = saveDemo(); flowDialog.close(); syncIdentity(); renderRoute();
    showToast(persisted ? (result?.message || 'Perubahan berhasil disimpan.') : 'Perubahan berlaku sementara.');
  };
  flowDialog.showModal();
}
function field(label, name, value='', attrs='') {
  return `<label class="form-field">${label}<input name="${name}" value="${escapeHtml(value)}" ${attrs}></label>`;
}
function confirmLocal(title, message, action, onSave) {
  openForm(title,`<p>${message}</p>`,action,onSave);
}
function openAddress(id) {
  const address = addresses.find(item=>item.id===id);
  openForm(address ? 'Edit alamat' : 'Tambah alamat',
    field('Label alamat','label',address?.label || '', 'required maxlength="40" placeholder="Rumah, Kantor"') +
    field('Nama penerima','recipient',address?.recipient || demo.profile.name,'required minlength="2" maxlength="80" autocomplete="name"') +
    field('Nomor HP penerima','phone',address?.phone || demo.profile.phone,'required type="tel" autocomplete="tel"') +
    field('Email (opsional)','email',address?.email || '', 'type="email" maxlength="120"') +
    `<label class="form-field">Alamat lengkap<textarea name="addressLine" required minlength="12" maxlength="300" rows="3">${escapeHtml(address?.addressLine || '')}</textarea></label>` +
    `<label class="form-field">Kecamatan<select name="districtId" aria-label="Kecamatan" required><option value="">Pilih kecamatan</option>${Object.entries(districtFixtures).map(([key,district])=>`<option value="${key}" ${String(address?.districtId)===key?'selected':''}>${district.label}, ${district.city}</option>`).join('')}</select></label><p class="field-help">Kota dan provinsi otomatis mengikuti pilihan kecamatan.</p>` +
    field('Kode pos','postcode',address?.postcode || '', 'required pattern="[0-9]{5}" inputmode="numeric" maxlength="5"') +
    `<label class="check-row"><input type="checkbox" name="primary" ${address?.primary || !addresses.length ? 'checked':''}>Jadikan alamat utama</label>`, 'Simpan alamat', data=>{
      const phone = normalizeIndonesianPhone(String(data.get('phone')));
      if (!phone) return {error:'Masukkan nomor HP Indonesia yang valid.',field:'phone'};
      if (String(data.get('recipient')).trim().length < 2) return {error:'Nama penerima minimal 2 karakter.',field:'recipient'};
      if (String(data.get('addressLine')).trim().length < 12) return {error:'Lengkapi nama jalan, nomor, atau patokan alamat.',field:'addressLine'};
      if (!String(data.get('label')).trim()) return {error:'Isi label alamat.',field:'label'};
      const district = districtFixtures[data.get('districtId')];
      if (!district) return {error:'Pilih kecamatan yang tersedia.',field:'districtId'};
      const updated = {id:address?.id || `demo-address-${crypto.getRandomValues(new Uint32Array(2)).join("-")}`,label:String(data.get('label')).trim(),recipient:String(data.get('recipient')).trim(),phone,email:String(data.get('email')).trim(),addressLine:String(data.get('addressLine')).trim(),districtId:Number(data.get('districtId')),districtLabel:district.label,city:district.city,province:district.province,postcode:String(data.get('postcode')),primary:data.has('primary') || !addresses.length};
      if (address?.primary && !updated.primary && addresses.length === 1) updated.primary = true;
      if (updated.primary) addresses.forEach(item=>item.primary=false);
      if (address) Object.assign(address,updated); else addresses.push(updated);
      if (!addresses.some(item=>item.primary)) addresses[0].primary=true;
      checkoutState.addressIndex = addresses.findIndex(item=>item.primary);
      checkoutState.simulation = null; checkoutState.repriceConfirmed = false;
    });
}
function openClaim() {
  openForm('Cari pesanan saya', `<p>Hubungkan pesanan Anda menggunakan nomor pesanan dan kode verifikasi.</p>
    <div class="prototype-hint">Contoh uji coba: nomor pesanan <strong>DEMO-GUEST-001</strong>, kode bukti <strong>CLAIM-246810</strong>.</div>`+
    field('Nomor pesanan','order','', 'required autocomplete="off"')+
    field('Kode bukti pesanan','proof','', 'required autocomplete="off"')+
    `<label class="check-row"><input name="consent" type="checkbox" required>Saya menghubungkan pesanan Kopi Senja ke akun ini. Toko menerima kontak dan alamat yang saya pilih, bukan riwayat toko lain.</label>`, 'Verifikasi dan hubungkan', data=>{
      if (String(data.get('order')).trim()!=='DEMO-GUEST-001' || String(data.get('proof')).trim()!=='CLAIM-246810') return {error:'Pesanan belum dapat diverifikasi. Periksa nomor dan bukti pesanan.',field:'proof'};
      if (!data.has('consent')) return {error:'Persetujuan diperlukan untuk menghubungkan pesanan.',field:'consent'};
      demo.claimed = true;
      if (!demo.connections.includes('kopi')) demo.connections.push('kopi');
      history.pushState(null,'','/orders/DEMO-GUEST-001');
      return {message:'Pesanan berhasil dihubungkan ke akun Anda.'};
    });
}
function addRequest(type, message, order=null) {
  // Fixture request ids identify local review records, never real support tickets.
  if (demo.requests.some(item=>item.type===type && item.order===order && item.message===message)) return;
  demo.requests.push({id:`DEMO-${demo.requests.length+1}`,type,message,order});
}
function openRecovery() {
  openForm('Pulihkan akses akun', `<p>Jika nomor lama tidak bisa diakses, permintaan perlu ditinjau. Form ini tidak langsung memberikan akses ke akun atau pesanan.</p>`+
    field('Nomor lama','oldPhone','', 'required type="tel"')+field('Email untuk tindak lanjut','email','', 'required type="email" maxlength="120"')+
    `<label class="form-field">Keterangan<textarea name="reason" required minlength="12" maxlength="500" rows="3"></textarea></label>`, 'Kirim permintaan', data=>{
      if (!normalizeIndonesianPhone(String(data.get('oldPhone')))) return {error:'Periksa nomor HP lama.',field:'oldPhone'};
      if (String(data.get('reason')).trim().length<12) return {error:'Jelaskan kendala sedikitnya 12 karakter.',field:'reason'};
      addRequest('Pemulihan akun',String(data.get('reason')).trim());
      return {message:'Permintaan pemulihan akun sedang menunggu peninjauan.'};
    });
}
document.addEventListener('submit', event=>{
  if (event.target.id!=='order-search') return;
  event.preventDefault();
  const params = new URLSearchParams(new FormData(event.target));
  history.pushState(null,'',`/orders?${params}`);renderRoute();
});
document.addEventListener('change',event=>{
  const key = event.target.dataset.preference;
  if (!['updates','promos'].includes(key)) return;
  demo.preferences[key]=event.target.checked;saveDemo();showToast('Preferensi notifikasi tersimpan.');
});
document.addEventListener('click', event=>{
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const {action,id} = button.dataset;
  if (action==='address') openAddress(id);
  else if (action==='address-primary') {
    addresses.forEach(item=>item.primary=item.id===id);
    checkoutState.addressIndex=addresses.findIndex(item=>item.primary);checkoutState.simulation=null;
    saveDemo();renderRoute();showToast('Alamat utama diperbarui.');
  } else if (action==='address-delete') {
    const address = addresses.find(item=>item.id===id);
    confirmLocal(`Hapus alamat ${escapeHtml(address.label)}?`,'Alamat ini hilang dari daftar tersimpan. Alamat pada pesanan lama tetap sama.','Hapus alamat',()=>{
      addresses.splice(addresses.indexOf(address),1);
      if (addresses.length && !addresses.some(item=>item.primary)) addresses[0].primary=true;
      checkoutState.addressIndex=Math.max(0,addresses.findIndex(item=>item.primary));checkoutState.simulation=null;
    });
  } else if (action==='profile') {
    openForm('Edit profil',field('Nama','name',demo.profile.name,'required minlength="2" maxlength="80"')+field('Email (opsional)','email',demo.profile.email,'type="email" maxlength="120"'),'Simpan profil',data=>{
      if (String(data.get('name')).trim().length<2) return {error:'Nama minimal 2 karakter.',field:'name'};
      demo.profile.name=String(data.get('name')).trim();demo.profile.email=String(data.get('email')).trim();
    });
  } else if (action==='phone') {
    openForm('Ubah nomor HP',`<p>Nomor lama: ${escapeHtml(formatPhoneId(demo.profile.phone))}.</p>`+field('Nomor HP baru','phone','','required type="tel"')+field('Kode verifikasi demo','otp','','required pattern="[0-9]{6}" inputmode="numeric" autocomplete="one-time-code"')+'<p class="field-help">Masukkan kode verifikasi 123456 untuk konfirmasi.</p>','Verifikasi nomor',data=>{
      const phone=normalizeIndonesianPhone(String(data.get('phone')));
      if (!phone) return {error:'Nomor HP baru tidak valid.',field:'phone'};
      if (data.get('otp')!=='123456') return {error:'Kode verifikasi salah. Gunakan 123456.',field:'otp'};
      demo.profile.phone=phone;
    });
  } else if (action==='revoke' || action==='revoke-all') {
    confirmLocal('Keluarkan perangkat lain?','Sesi di perangkat ini tetap aktif. Perangkat lain yang dikeluarkan perlu masuk kembali.','Keluarkan perangkat',()=>{demo.sessions=action==='revoke-all'?[]:demo.sessions.filter(item=>item.id!==id)});
  } else if (action==='disconnect') {
    confirmLocal(`Putuskan ${stores[id].name}?`,'Penggunaan kontak/alamat untuk checkout berikutnya dihentikan. Riwayat pesanan dan catatan transaksi toko tidak dihapus.','Putuskan koneksi',()=>{demo.connections=demo.connections.filter(key=>key!==id)});
  } else if (action==='connect') {
    openForm(`Hubungkan ${stores[id].name}`, '<p>Toko dapat menerima kontak dan alamat yang Anda pilih saat checkout. Pesanan toko lain dan perangkat Anda tidak dibagikan.</p><label class="check-row"><input name="consent" type="checkbox" required>Saya menyetujui koneksi toko ini.</label>','Hubungkan toko',data=>{if(data.has('consent')&&!demo.connections.includes(id))demo.connections.push(id)});
  } else if (action==='claim') openClaim();
  else if (action==='recovery') openRecovery();
  else if (action==='help') {
    const order=accountOrders().find(item=>item.number===id);
    openForm(`Bantuan ${storeForOrder(order).name}`,`<p>Pesanan ${id}</p><label class="form-field">Jenis masalah<select name="type" required><option value="">Pilih masalah</option><option>Pembayaran</option><option>Pengiriman</option><option>Barang tidak sesuai</option>${['baru','diproses'].includes(order.status)?'<option>Permintaan pembatalan</option>':''}${['selesai','retur'].includes(order.status)?'<option>Permintaan retur</option>':''}<option>Lainnya</option></select></label><label class="form-field">Ceritakan masalahnya<textarea name="message" required minlength="12" maxlength="500" rows="4"></textarea></label><p class="field-help">Pesan bantuan akan diteruskan ke tim toko.</p>`,'Kirim bantuan',data=>{
      const message=String(data.get('message')).trim();
      if(message.length<12)return {error:'Jelaskan masalah sedikitnya 12 karakter.',field:'message'};
      addRequest(String(data.get('type')),message,id);
    });
  } else if (action==='payment') {
    const mode=new URLSearchParams(location.search).get('payment');
    confirmLocal('Konfirmasi pembayaran?',mode==='delayed'?'Periksa ulang status pesanan yang sama tanpa membuat pembayaran ganda.':'Tandai pesanan ini sudah dibayar untuk melanjutkan.','Konfirmasi pembayaran',()=>{
      demo.payments ||= {};demo.payments[id]='paid';
      return {message:'Pembayaran berhasil diverifikasi.'};
    });
  } else if (['export','closure','cod-review'].includes(action)) {
    const type={export:'Salinan data akun',closure:'Penutupan akun','cod-review':'Peninjauan akses COD'}[action];
    openForm(type,`<p>${action==='closure'?'Permintaan penutupan akun akan ditinjau terlebih dahulu. Catatan transaksi toko tetap disimpan sesuai ketentuan.':action==='export'?'Minta salinan profil, alamat, dan riwayat pesanan Anda.':'Jelaskan kendala yang ingin ditinjau terkait akses COD.'}</p><label class="form-field">Keterangan<textarea name="reason" required minlength="12" maxlength="500" rows="3"></textarea></label>`,'Kirim pengajuan',data=>{
      const reason=String(data.get('reason')).trim();if(reason.length<12)return {error:'Tambahkan keterangan sedikitnya 12 karakter.',field:'reason'};
      addRequest(type,reason);
    });
  }
});
syncIdentity();

document.addEventListener("click", async (event) => {
  const retryButton = event.target.closest("[data-retry-scenario]");
  if (retryButton) {
    const params = new URLSearchParams(window.location.search);
    params.delete("scenario");
    const query = params.toString();
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}`);
    renderRoute();
    return;
  }
  
  const notificationLink = event.target.closest("[data-notif-id]");
  if (notificationLink) {
    const notification = notifications.find((item) => item.id === notificationLink.dataset.notifId);
    if (notification) {
      notification.isRead = true;
      updateNotificationBadge();
    }
  }
  const link = event.target.closest("a");
  if (link && link.origin === window.location.origin && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && !link.download && link.target !== "_blank") {
    if (link.getAttribute("href") && link.getAttribute("href").startsWith("/")) {
      event.preventDefault();
      history.pushState(null, "", link.pathname + link.search);
      renderRoute();
      return;
    }
  }
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    let newPath = routeButton.dataset.route === "profile" ? "account" : routeButton.dataset.route;
    if (!newPath.startsWith('/')) newPath = '/' + newPath;
    history.pushState(null, "", newPath);
    renderRoute();
    return;
  }
  const orderButton = event.target.closest("[data-order]");
  if (orderButton) {
    history.pushState(null, "", `/orders/${orderButton.dataset.order}`);
    renderRoute();
    return;
  }
  const filterButton = event.target.closest("[data-filter]");
  if (filterButton) {
    const params = new URLSearchParams(location.search);
    params.set("status", filterButton.dataset.filter);
    history.pushState(null,"",`/orders?${params}`);
    renderRoute();
    return;
  }
  if (event.target.closest("#profile-logout")) {
    handleLogout();
    return;
  }
  if (event.target.closest("#mark-all-read")) {
    notifications.forEach((notification) => { notification.isRead = true; });
    updateNotificationBadge();
    renderNotifications();
    showToast("Semua notifikasi ditandai sudah dibaca.");
    return;
  }
  const copyButton = event.target.closest("[data-copy-code]");
  if (copyButton) {
    try {
      await navigator.clipboard.writeText(copyButton.dataset.copyCode);
      showToast(`Kode "${copyButton.dataset.copyCode}" disalin.`);
    } catch {
      showToast("Kode belum dapat disalin. Pilih dan salin kode secara manual.");
    }
    return;
  }
  const copyTextButton = event.target.closest("[data-copy-text]");
  if (copyTextButton) {
    try {
      await navigator.clipboard.writeText(copyTextButton.dataset.copyText);
      showToast(copyTextButton.dataset.copyMessage || `Disalin: ${copyTextButton.dataset.copyText}`);
    } catch {
      showToast("Teks belum dapat disalin secara otomatis.");
    }
    return;
  }
  const demoButton = event.target.closest("[data-demo-action]");
  if (demoButton) showToast(`Aksi: ${demoButton.dataset.demoAction}`);
});

window.addEventListener("popstate", renderRoute);

document.querySelector("#theme-toggle")?.addEventListener("click", () => {
  const isDark = document.documentElement.classList.toggle("dark");
  try {
    localStorage.setItem("tokophi_theme", isDark ? "dark" : "light");
  } catch {}
});

document.querySelector("#close-merchant").addEventListener("click", () => {
  if (window.location.search.includes("preview=merchant")) {
    window.location.search = "";
  } else {
    merchantShell.hidden = true;
    buyerShell.hidden = false;
  }
  buyerShell.hidden = false;
  window.scrollTo(0, 0);
  content.focus({ preventScroll: true });
});

document.querySelector("#tenant-select").addEventListener("change", (event) => renderMerchant(event.target.value));

const loginShell = document.querySelector("#login-shell");
const phoneForm = document.querySelector("#phone-form");
const otpForm = document.querySelector("#otp-form");
const loginPhone = document.querySelector("#login-phone");
const phoneError = document.querySelector("#phone-error");
const loginOtp = document.querySelector("#login-otp");
const otpError = document.querySelector("#otp-error");
const displayPhone = document.querySelector("#display-phone");
const editPhoneBtn = document.querySelector("#edit-phone");
const verifyBtn = document.querySelector("#verify-button");
const resendBtn = document.querySelector("#resend-otp");
const resendStatus = document.querySelector("#resend-status");
let otpExpired = new URLSearchParams(location.search).get('otp') === 'expired';
const otpDelayed = new URLSearchParams(location.search).get('otp') === 'delayed';

if (loginPhone) {
  loginPhone.addEventListener("input", () => {
    loginPhone.removeAttribute("aria-invalid");
    phoneError.hidden = true;
  });
}

if (phoneForm) {
  phoneForm.addEventListener("submit", (e) => {
    e.preventDefault();
    let rawValue = loginPhone.value.replace(/\D/g, "");
    if (rawValue.startsWith("62")) rawValue = rawValue.slice(2);
    else if (rawValue.startsWith("0")) rawValue = rawValue.slice(1);
    if (!/^(8\d{7,11})$/.test(rawValue)) {
      loginPhone.setAttribute("aria-invalid", "true");
      phoneError.hidden = false;
      loginPhone.focus();
      return;
    }

    loginPhone.value = rawValue;
    const formatted = rawValue.replace(/(\d{3})(\d{4})(\d+)/, "$1-$2-$3");
    displayPhone.textContent = `+62 ${formatted}`;
    if (otpDelayed) { resendStatus.textContent='Kode terlambat? Periksa nomor atau kirim ulang kode verifikasi.';resendStatus.hidden=false; }
    
    phoneForm.hidden = true;
    otpForm.hidden = false;
    loginOtp.value = "";
    loginOtp.removeAttribute("aria-invalid");
    otpError.hidden = true;
    verifyBtn.disabled = true;
    loginOtp.focus();
  });
}

if (editPhoneBtn) {
  editPhoneBtn.addEventListener("click", () => {
    otpForm.hidden = true;
    phoneForm.hidden = false;
    loginPhone.focus();
  });
}

if (loginOtp) {
  loginOtp.addEventListener("input", () => {
    loginOtp.value = loginOtp.value.replace(/\D/g, "");
    loginOtp.removeAttribute("aria-invalid");
    otpError.hidden = true;
    verifyBtn.disabled = loginOtp.value.length !== 6;
  });
}

if (otpForm) {
  otpForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (otpExpired) {
      otpError.textContent = 'Kode verifikasi kedaluwarsa. Kirim ulang untuk mendapatkan kode baru.';
      otpError.hidden = false; loginOtp.setAttribute('aria-invalid','true'); loginOtp.focus(); return;
    }
    if (loginOtp.value === "123456") {
      demo.signedIn = true; saveDemo(); syncIdentity();
      loginShell.hidden = true;
      buyerShell.hidden = false;
      const params = new URLSearchParams(window.location.search);
      if (params.get("flow") === "checkout") {
        history.pushState(null, "", "/checkout");
      } else if (window.location.pathname === "/" || window.location.pathname === "/index.html") {
        history.pushState(null, "", "/orders");
      }
      renderRoute();
    } else {
      otpError.textContent = "Kode OTP salah. Masukkan kode 123456.";
      loginOtp.setAttribute("aria-invalid", "true");
      otpError.hidden = false;
      loginOtp.focus();
    }
  });
}

if (resendBtn) {
  resendBtn.addEventListener("click", () => {
    otpExpired = false;
    resendStatus.textContent = 'Kode demo disiapkan ulang';
    resendBtn.disabled = true;
    setTimeout(() => { resendBtn.disabled = false; }, 3000);
    loginOtp.value = "";
    loginOtp.removeAttribute("aria-invalid");
    otpError.hidden = true;
    verifyBtn.disabled = true;
    resendStatus.hidden = false;
    loginOtp.focus();
    showToast("Kode demo disiapkan ulang");
    setTimeout(() => {
      if (resendStatus) resendStatus.hidden = true;
    }, 4000);
  });
}

function handleLogout() {
  demo.signedIn = false; saveDemo();
  buyerShell.hidden = true;
  loginShell.hidden = false;
  phoneForm.hidden = false;
  otpForm.hidden = true;
  loginPhone.value = "81234567890";
  loginPhone.removeAttribute("aria-invalid");
  phoneError.hidden = true;
  loginOtp.value = "";
  loginOtp.removeAttribute("aria-invalid");
  otpError.hidden = true;
  if (verifyBtn) verifyBtn.disabled = true;
  resendStatus.hidden = true;
  merchantShell.hidden = true;
  history.pushState(null, "", "/");
  notifications.forEach((notification, index) => { notification.isRead = initialNotificationReadStates[index]; });
  updateNotificationBadge();
}

updateNotificationBadge();


if (window.location.search.includes("preview=merchant")) {
  loginShell.hidden = true;
  buyerShell.hidden = true;
  merchantShell.hidden = false;
  renderMerchant("batik");
} else {
  renderRoute();
}
