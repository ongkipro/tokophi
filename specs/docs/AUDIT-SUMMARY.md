# TokoΦ — Pre-Release Audit and Remediation Summary (2026-08-16)

> **Status:** Observed audit report, not a production certification.
>
> **Change boundary:** Source, configuration, schema, documentation, tests, and local runtime were inspected. No production mutation, deployment, payment, courier booking, payout, DNS change, or secret read was performed.
>
> **Execution contract:** [`REQUIREMENTS.md`](./REQUIREMENTS.md) owns accepted behavior. Root [`TASKS.md`](../../TASKS.md) owns the active implementation sequence. This document owns dated audit evidence only.

## Release verdict

**Not ready for unrestricted production release.**

The repository has a strong technical base: all workspace TypeScript/Astro checks complete, the dedicated local database suite passes all 90 files and 722 tests, migration and RLS verifiers pass, and local browser exercises reached seller, storefront, landing, cart, checkout, and suspended-store states. Those controls do not cover the remaining release blockers. Thirteen P0 tasks still permit false success, cross-state corruption, replay, owner-database fallback, unauditable impersonation, or direct API behavior that contradicts storefront availability.

The active queue contains **42 tasks: 13 P0, 20 P1, and 9 P2**. Stage 7 is the only release gate. A green default `npm test` is not full evidence because it runs **82 files / 662 tests and skips 8 DB-coupled files / 60 tests** without the dedicated database. The DB-backed run passes **90 files / 722 tests**.

## Scope and evidence

| Area | Evidence collected | Boundary |
|---|---|---|
| Repository structure | All workspaces, deployable surfaces, schema/migrations, scripts, CI, Docker Compose, OpenAPI, and canonical specification directories mapped | Generated/cache/vendor directories excluded from source conclusions |
| Data and tenancy | Drizzle schema, 95-entry migration journal, RLS verifiers, tenant context, object ownership, app/owner DB connection behavior | Local PostgreSQL only; production DB was not read |
| Security | Auth/session/cookie flows, seller/platform RBAC, public APIs, cron/webhook paths, upload/storage, impersonation, secrets scan | No credential contents or live auth sessions inspected |
| Commerce correctness | Cart/order/payment/inventory/ledger/payout/shipping transitions and concurrency boundaries traced | No real payment, courier, payout, or order mutation |
| UI and responsive behavior | Seller and storefront route sweeps, keyboard/menu behavior, product editor, cart/checkout, landing, suspended storefront | Local development surfaces; no production certification |
| Delivery and operations | Compose validation, CI workflow, build/check scripts, release/readiness claims, observability and backup documentation | No deploy, restore drill, external provider call, or live rollback |
| Documentation | Requirement, task, audit, status, architecture, security, API, operations, and release claims cross-checked against code and executable evidence | Historical prose remains evidence, never implementation truth |

## Gate results

| Gate | Result | Release meaning |
|---|---|---|
| `npm test` | 82 files passed, 8 skipped; 662 tests passed, 60 skipped | Offline signal only; DB suites did not run |
| DB-backed suite | 90 files passed; 722 tests passed | Strong local DB evidence |
| Admin TypeScript | 0 errors | Pass |
| Super Admin TypeScript | 0 errors | Pass |
| Storefront Astro check | 0 errors, 0 warnings, 14 hints | Pass with non-blocking hints |
| Landing Astro check | 0 errors, 0 warnings, 0 hints | Pass |
| Admin + Super Admin lint | 6 errors, 4 warnings | Release gate fails |
| Migration verifier | 95 entries through `0094`; pass | Pass |
| RLS verifier | 52/53 store-scoped tables plus the documented `platform_activity` exception; pass | Existing verifier passes; direct `inventory_levels` isolation and runtime DB identity remain open |
| Compose config | Parses with validation-only required values | Syntax passes; effective restricted runtime identity is not proven |
| Secret scanner | Repository scan completed; no confirmed source secret in the audited paths | Does not cure the reusable responsive-audit credential |
| OpenAPI lint | Both files parse with 7 warnings | Syntax signal only; route coverage and reproducibility remain open |
| Traceability checker | 31 structural findings | Documentation gate fails |
| Responsive seller sweep | Shared topbar overflows by 27 px at 320 CSS px on all 15 sampled seller routes | Accessibility/responsive gate fails |

## Active remediation map

### P0 — release blockers

| Task | Requirement | Finding and root cause |
|---|---|---|
| 4.1 | NF-10 | Responsive audit script embeds reusable seller credentials. |
| 4.2 | F-T9 | `/api/public/order` resolves an active product but does not enforce store public availability; a suspended store can still receive direct API attempts. |
| 4.3 | F-M13 | Payment request creation is check-then-create; concurrent requests can create more than one provider/local payment. |
| 4.4 | F-C6 | Incoming Inventory derives receipt quantities instead of reading persisted receipt facts. |
| 4.5 | F-C7 | Quick stock edit broadcasts one aggregate quantity across variants instead of updating the selected variant with stale-write protection. |
| 4.6 | F-C10 | `Buat PO` closes a dialog but creates no purchase order. |
| 4.7 | F-P7 | Navigation creation can report success without a committed menu transaction. |
| 4.8 | F-O8 | Public order idempotency uses a preflight read; concurrent submissions can pass before either transaction claims the checkout session. |
| 4.9 | F-C11 | Purchase-order receipt reads state before the transaction and does not serialize concurrent receipt attempts. |
| 4.10 | F-M14 | Subscription callbacks can regress a paid invoice and extend entitlement again on later replay/out-of-order events. |
| 4.11 | SEC-10 | Impersonation places a reusable JWT in a URL, permits replay until expiry, and drops operator identity from the merchant session. |
| 4.12 | SEC-18 | `DATABASE_RUNTIME_ROLE=app` can silently reuse the owner `DATABASE_URL`; a label claims RLS while bare queries retain owner power. |
| 4.13 | SEC-16 | First-party callback/cron credentials are accepted in query strings; callback identity must also resolve exactly one payment. |

### P1 — high-priority correctness and release governance

| Tasks | Requirements | Scope |
|---|---|---|
| 5.1–5.3 | F-S12, F-C8, SEC-15 | Shipment reconciliation, truthful product controls, race-safe invitations |
| 5.4–5.6 | F-F10, F-F11, F-C9 | Checkout error states, 320 px topbar, state-aware navigation guards |
| 5.7–5.8 | NF-9, F-K11 | Full commerce lifecycle integration test and explicit TokoΦ Account release decision |
| 5.9–5.10 | F-T10, F-M15 | Deterministic multi-store context and locked payout transitions |
| 5.11–5.13 | NF-13, NF-14, NF-15 | Green lint baseline, four production builds in CI, reproducible HTTP contract coverage |
| 5.14–5.15 | NF-16, NF-17 | One documentation authority map and repaired active traceability |
| 5.16 | F-F12 | Persisted CMS page bodies must not be replaced with title-derived filler |
| 5.17–5.18 | SEC-9, F-S8 | Platform role enforcement at route entry and honest known-versus-legacy-unknown courier analytics |
| 5.19–5.20 | F-S9/F-S10, F-T6 | Evidence-backed COD return economics and a real Google OAuth contract smoke test |

### P2 — hardening and lean cleanup

| Tasks | Requirements | Scope |
|---|---|---|
| 6.1–6.3 | NF-18, F-T8, NF-6 | Explicit offline/release commands, direct inventory RLS, shared production rate limits |
| 6.4–6.6 | NF-19, SEC-17, NF-12 | Confirmed dependency removal, active SVG handling, bounded release-critical modules |
| 6.7–6.9 | NF-20, NF-21, F-F7 | Remove runtime mock fixtures from production type paths; standardize package manager/lockfiles; persist per-store public contact email |

## Second-pass gap review

The final cross-check found five accepted requirements that had evidence but no executable closure task, plus five partial requirements that were already owned by adjacent tasks but not traced there:

- **Platform route roles (`SEC-9`):** `platform-auth.ts` carries the operator role and privileged actions check it, but `apps/super-admin/middleware.ts` proves only that a platform session cookie exists. Route-entry authorization remains explicit Task 5.17; hiding navigation is not enforcement.
- **Courier return analytics (`F-S8`):** the public-order route already snapshots its server-verified courier and service type for new orders, correcting the earlier assumption that all new data was missing. Legacy null-courier rows remain unknowable. Task 5.18 therefore owns honest per-courier denominators and a separate unknown-coverage count, not fabricated backfill.
- **COD economics (`F-S9`, `F-S10`):** the SPX return-cost premise has no written KiriminAja evidence, while `platform_cod.fee_pct` is seeded to zero and unused. Task 5.19 blocks policy expansion or charging until provider evidence and a complete owner-approved money contract exist.
- **Google OAuth (`F-T6`):** local tests cover mocked protocol branches, not a real provider/account exchange. Task 5.20 requires an environment-only test client and browser smoke test; credentials remain outside repository evidence.
- **Per-store contact email (`F-F7`):** the storefront correctly removed the shared Batik Nusantara address because the store model has no public email field. Task 6.9 adds tenant-owned persistence and preserves an honest empty state.
- **Existing-task traceability:** Tasks 4.2, 4.4, 5.5, 5.8, 6.2, and 6.3 now explicitly own the related `F-P4`, `SEC-6`/`F-C2`, `NF-7`, `F-K12`/`F-K13`, `SEC-1`/`F-T1`, and `F-F5` partial requirements. This changes planning coverage only; no requirement was promoted to MET.

## Documentation contract verification

The canonical pack was revalidated after the ownership, status, table, link, and identifier repairs:

- `check-traceability.py specs --stage ready --format json` scanned **128 files**, **65 declarations**, and **12 recognized historical task contracts** with **0 findings**.
- The same checker passed at `--stage verified` with **0 findings**. This covers resolvable numeric references, duplicate declarations, accountable ownership, Markdown table structure, local links, task primaries, and stage-aware claim/evidence rules.
- An independent root-queue contract scan found **42 active Stage 4–6 tasks**: **13 P0, 20 P1, and 9 P2**. Every task has one requirement, target files, a bounded change, and an observable `Done when`; no task ID is duplicated and every primary requirement resolves in [`REQUIREMENTS.md`](./REQUIREMENTS.md).

This is current planning evidence, not a permanent repository gate. Task 5.15 / `NF-17` still owns the repository-local `npm run verify:traceability` command and CI enforcement; neither is claimed as implemented by this documentation pass.

## Regression review

- **Landing:** Typecheck passes; canonical route/content claims remain subject to the documentation and release gates.
- **Storefront:** Home, listing, PDP, cart, checkout, and suspended-store behavior were exercised locally. The storefront correctly refuses a suspended host, but the public order API does not share that boundary yet.
- **Seller Admin:** Navigation, product list/editor, inventory, purchasing, settings, and responsive topbar paths were inspected. False-success controls and state/persistence mismatches are represented in Tasks 4.4–4.7 and 5.2/5.6/5.16.
- **Super Admin:** Platform actions, route-level role boundaries, payout/impersonation paths, and COD analytics/economics were traced. UI hiding is not accepted as authorization, a state-machine guard, provider evidence, or an honest legacy-data denominator.
- **Backend and data:** Existing migration/RLS/ledger guards are materially useful. The uncovered failures sit at concurrency, effective runtime identity, direct child-table isolation, and incomplete end-to-end composition.
- **Delivery:** Compose syntax is healthy, but CI does not prove all deployable builds, lint is red, the release command can skip DB tests, and backup/restore claims lack a current executable drill.

## Security audit interpretation

The automated source scanner and targeted manual review found no confirmed plaintext secret in the audited source set. That is not a clean security certification. Security remains blocked by the embedded audit credential, URL-borne reusable credentials, replayable impersonation, lost operator provenance, incomplete platform route-role enforcement, in-process rate limits, active SVG acceptance, and unproven restricted DB identity. Security statuses in `REQUIREMENTS.md` must change only after the corresponding executable acceptance checks pass.

## Implementation rule

Implement only from root `TASKS.md`, in wave order. Shared-file lanes remain sequential; independent lanes may run in parallel. Each task must update its requirement status from executable evidence, not from code inspection alone. Production deployment remains a separate approval-gated action after Stage 7.

---

# Historical Audit Record — Waves 1–8

## Original Wave 1–8 Summary

> **Untuk Paduka Ongki.** Ini rekap delapan gelombang audit: wave 1–7 mencatat pemeriksaan 2026-08-01
> sampai 2026-08-03, dan wave 8 menambahkan bukti pre-release 2026-08-16. Ditulis dari **bukti** —
> commit body, file guard, source review, browser exercise, dan pengukuran yang dijalankan ulang.
>
> **Aturan main dokumen ini:** repo ini punya budaya "temuan tanpa angka itu opini". Jadi setiap temuan
> di bawah membawa angka yang membuktikannya. Di Bagian 5 (temuan baru), setiap poin diberi label
> **`[DIUKUR]`** atau **`[DIBACA]`** — dibaca artinya saya membaca kodenya dan yakin, tapi saya **tidak**
> menjalankan hal yang membuktikannya. Membedakan dua hal itu adalah bagian termahal dari audit ini;
> tiga klaim sudah pernah ditarik kembali di sesi-sesi sebelumnya karena batas itu kabur.
>
> Sumber: `git log origin/main` (commit `2399ea5` · `52ef1de` · `206c75d` · `9af5ed7` · `9b8de86` ·
> `b5f9ded` dan PR shipping `#142`–`#145`), `specs/docs/tasks/NEXT.md`, `specs/docs/BACKLOG.md`,
> `CHANGELOG.md`, dan file guard-nya sendiri.

---

## Ringkasan satu paragraf

Enam gelombang audit menemukan **enam kelas kegagalan yang sama berulang**, bukan enam puluh bug lepas:
(1) aturan yang benar hidup di paket yang salah sehingga hanya satu surface bisa mematuhinya;
(2) gerbang yang tidak pernah dijalankan — 22 tes uang yang skip, `verify-rls` merah berminggu-minggu,
`astro check` yang tidak ada yang memanggil; (3) guard yang membaca **teks** file, bukan **kode**-nya,
sehingga sebaris `//` bisa mematikan seluruh alarmnya; (4) tanggal beku milik seed yang bocor ke jalur
**tulis** aplikasi; (5) perbaikan yang menambal **instance** dan melewatkan **kelas**-nya; dan (6) UI
yang melaporkan sukses atas operasi yang tidak pernah terjadi. Yang paling mahal dalam rupiah: 10 dari
22 produk **tidak pernah bisa dibeli** dan tidak punya satu pun line item seumur hidupnya, serta selisih
**Rp41.100 per paket** karena kuotasi dan booking mengukur kotak yang berbeda.

---

## Bagian 1 — Apa yang ditemukan dan diperbaiki

### 🔴 Kritis — uang, akses, atau data pelanggan

| # | Temuan | Pengukuran yang membuktikannya | Perbaikan |
|---|---|---|---|
| 1 | **10 dari 22 produk tidak bisa dibeli, dan tidak pernah bisa.** `products.sizes` (jsonb legacy, display-only) memunculkan size-picker cadangan di PDP; `addToCart` menaruh string ukuran itu ke `cart.variant`, sedangkan `/api/public/order` menuntut kecocokan persis dengan `product_variants.title` — yang untuk produk-produk itu bernama `Default`. Cart kirim `"All Size"`, DB minta `"Default"` → 400. | Produksi, read-only: **10 unbuyable dari 22 aktif** di `batik-nusantara`. Line item seumur hidup untuk 10 produk itu: **0**. Untuk 12 sisanya: **170**. Nol penjualan di sepuluh produk adalah jejak kaki bug-nya sendiri. Penolakan baru muncul di tombol **Bayar** — `shipping-weight.ts:93` jatuh ke varian posisi-0 saat judul meleset, jadi ongkir terkuotasi normal dan pembeli mengisi seluruh formulir dulu. | Picker cadangan dihapus; `cart.variant = d.variant \|\| ""`. **Cart yang sudah teracuni diperbaiki saat DIBACA**, bukan saat submit — string buruknya juga menyetir kuotasi ongkir, `content_ids` pixel, dan ringkasan. Guard `cart-variant.test.ts`. |
| 2 | **`createStore` mencetak `tokophi123` untuk setiap owner toko yang di-provision.** Alamat email merchant saja sudah jadi login OWNER yang bekerja di `app.tokophi.com`: setiap pesanan (nama, WhatsApp, alamat lengkap pembeli), setiap pelanggan, dan lewat `settings:write` rekening bank + `requestPayout`. | `DEV_PASSWORD` adalah string yang **diterbitkan di repo ini dan di `AGENTS.md`**. Tindak lanjut wave 4 mengukur dampaknya: **nol instance di produksi** — tidak satu pun dari 8 toko dibuat lewat `createStore` (7 seed, 1 self-serve lewat `provisionStore` yang memilih passwordnya sendiri). Tapi **7 dari 8 owner tetap verify terhadap `tokophi123`**, plus `admin@tokophi.id` (satu-satunya baris `platform_admins`). | Mint acak per toko, ditampilkan sekali lewat toast `duration: Infinity` (dialog akan ter-unmount oleh `router.push`). Guard `no-fixed-password.test.ts`. |
| 3 | **Ada DUA pencetak password, dan keduanya sudah melenceng — yang lebih lemah ada di jalur owner toko.** super-admin `randomBytes(3)` = **24 bit**; admin `randomBytes(4)` = **32 bit**. | Test barunya merah lebih dulu di kode lama: *"only 23.7 bits"* dan *"expected 4998 to be 5000"* — **24 bit sudah tabrakan dalam 5.000 undian**. Sekarang satu mint di `@tokophi/lib/password`: 12 simbol × Crockford base32 = **60 bit nominal**, **terukur 59,65 bit min-entropy atas 240.000 undian**, lantai test 48 bit. | Satu implementasi, enam call site pindah. ⚠️ File 24-bit itu **selamat dari commit yang mengklaim menghapusnya** (penghapusan ter-*stage* lalu hilang saat integrasi) karena guard-nya mengiterasi **daftar dua file hardcoded**. Scanner sekarang menyapu `git ls-files` seluruh repo. |
| 4 | **Kedua halaman login menerbitkan kredensial yang bekerja.** `rich.tokophi.com/login` menampilkan `admin@tokophi.id` + `tokophi123`; `app.tokophi.com/login` menampilkan `ongki@batiknusantara.id` + `tokophi123`. Seed benar-benar membuat baris itu saat deploy — jadi bukan placeholder. | Diverifikasi **live di produksi** sebelum diperbaiki, di kedua halaman. Dan ternyata **empat titik, bukan dua**: selain dua baris `Dev: …`, kedua input email membawa `defaultValue` berisi alamatnya — separuh yang paling sering terlewat, dan di control plane itu yang menyebutkan *akun mana yang harus diserang*. Limiter login di-key pada **IP, bukan akun**, dan **tidak ada satu pun failed login yang dicatat di tabel mana pun**. | Keempatnya dihapus; `placeholder` menunjukkan bentuknya tanpa menyebut siapa pun. Guard `no-published-credentials.test.ts` menyapu **setiap** file app. |
| 5 | **Tombol Suspend tidak melakukan apa-apa selama berbulan-bulan — dan bilang berhasil.** `setStoreStatus` menulis `stores.status` + baris audit berbunyi *"Toko ditangguhkan oleh platform"*, sementara yang memutuskan penguncian adalah `computeBilling()` yang **tidak pernah membaca kolom itu**. | Dijalankan dua arah: setelah "Tangguhkan", panel merchant tidak menampilkan banner, tombol "Tambah Produk" ada, dan **penyimpanan produk sungguhan berhasil tersimpan**. Setelah "Aktifkan", panel tetap read-only dan tombolnya tetap berbunyi "Aktifkan". Cron billing nightly menulis balik kolom itu dalam 24 jam. **Tidak ada cara yang bekerja untuk menangguhkan toko.** | `stores.suspended_at` + `suspended_reason` (migrasi 0086). `computeBilling` mengembalikan tiga hal: `status` (efektif), `billingStatus` (langganan saja — **ini yang dibaca uang**), dan `operatorSuspended`. |
| 6 | **Reset password meninggalkan sesi yang dicuri tetap hidup 7 hari.** Dua tuas incident-response — `/akun/keamanan` milik merchant dan "Reset password owner" milik operator — keduanya tidak mematikan cookie. | Dijalankan, bukan dinalar: login sebagai owner toko, `password_hash` ditimpa lewat psql mentah, browser **tetap terautentikasi** di `/produk`. Menghapus baris `store_users` **memang** memutus login — `getSession()` hanya membaca ulang keanggotaan dan peran, tidak rotasi. | `users.password_changed_at` (0087) + `sessionOutlivesPassword(iat, stamp)`, digabung ke pembacaan keanggotaan yang sudah ada — tetap **satu** round trip. ⚠️ Stempelnya **trigger DB, bukan konvensi pemanggil**: enam call site menulis password, dan rekam jejak repo ini adalah aturan yang diulang manual dipatuhi dua dari tiga. |
| 7 | **`analytics_daily` tidak punya penulis.** Satu-satunya penulisnya di seluruh repo adalah seed. | **Enam dari tujuh toko punya NOL baris** (dashboard kosong di atas pesanan sungguhan), dan yang ketujuh **beku** di 2026-07-02. Satu layar membantah dirinya sendiri, dijalankan 2026-08-03: *"Penjualan hari ini Rp 0, −100,0%"* di atas grafik berlabel "30 Hari Terakhir" yang sumbunya membaca 5 Jun → 2 Jul, sementara "Pesanan Terbaru" tepat di bawahnya memuat pesanan hari itu (SQL: **4 pesanan, Rp1.571.028**). | Tabel **dipensiunkan**. Seri diturunkan dari `orders` saat baca, `generate_series` LEFT JOIN agregat supaya deret tetap **rapat dan berakhir hari ini** — **~4 ms atas 885 pesanan**, dibatasi 121 hari. Cron ditolak: cron yang berhenti diam-diam mereproduksi bug ini persis sambil terlihat seperti software yang sehat. |
| 8 | **Kuotasi dan booking menghargai kotak yang berbeda.** KiriminAja memakai berat volumetrik (p × l × t ÷ 6) begitu melebihi berat asli. `createShipment` **selalu** mengirim dimensi saat booking; kuotasi hanya mengirim berat. Selisihnya ditanggung merchant. | Diukur live di sandbox, satu pesanan 1.000 g, 6138 → 2107, SPX Reguler: **berat saja Rp13.700 · berat + 40×30×20 cm Rp54.800 · berat 4.000 g Rp54.800** — angka dimensional dan volumetriknya cocok sampai ke rupiah. **Rp41.100 pada satu paket, 4× harga yang dikuotasi.** | `weightForCart` **dan** `weightForOrder` membaca `products.length_cm/width_cm/height_cm` dan mengembalikan maksimum per sumbu; dimensinya **masuk ke kunci cache tarif**. Guard `shipping-dimensions.test.ts`. ⚠️ Audit sebelumnya memeriksa `product_variants`, tidak menemukan apa-apa, lalu **salah menyimpulkan kolomnya tidak ada** — kolomnya ada di `products` sejak awal. |
| 9 | **Cancel mengirim ORDER ID sebagai AWB.** Dokumen vendor menyebutnya eksplisit: *"awb: AWB Number Already Obtained, **Not Order ID**"*. `cancelShipment` menyusun `o.awb ?? o.kaOrderId`, dan **setiap booking baru punya `awb: null`**. | Ditemukan dengan menjalankan rantai resi sungguhan: `request_pickup` → `{ok:true, kaOrderId:"5758-E2E68072665", pickupNumber:"XID-5544692486"}`, `tracking` → *"Tracking tidak tersedia"*, `cancel` → 🔴 **"Paket tidak ditemukan"**. Kiriman tetap hidup di kurir sementara merchant membaca error yang terdengar seperti paketnya tidak pernah ada — dan **jendela itu persis kapan orang membatalkan**: salah booking, beberapa detik lalu. | Cancel hanya menerima `o.awb`. Booking tanpa resi ditolak **sebelum** panggilan jaringan, dengan langkah berikutnya alih-alih kutipan vendor. Guard `cancel-shipment.test.ts`. |
| 10 | **Salinan keenam ekspresi default-location, di satu-satunya jalur tanpa RLS.** `/api/public/order` mendefinisikan `defaultLocationRow(variantId)` sendiri **tanpa predikat `store_id` sama sekali**, di rute yang tidak punya sesi dan berjalan di koneksi OWNER. `inventory_levels` tidak punya `store_id`, jadi join ke `locations` memilih baris tanpa membuktikan itu milik siapa. | Diverifikasi di `tokophi_test`, di-rollback: varian toko A yang punya stok di lokasi default A **resolve untuk A dan mengembalikan null untuk B**, sementara subselect lama menyerahkan baris A ke pemanggil yang tidak menyebut toko mana pun. | Delapan situs sekarang lewat `lib/inventory-location.ts`. |
| 11 | **`resetStoreUserPassword` berjalan di rank `admin` dan mencari targetnya hanya lewat `userId`** — tanpa join `store_users`, tanpa filter `storeId`. Operator rank-2 bisa me-reset password **owner toko mana pun** di platform, dan `storeId` hanya dipakai untuk baris log, jadi jejak auditnya bisa diarahkan ke toko yang salah. | Perbandingan langsung dengan `resetOwnerPassword` di sebelahnya, yang sudah benar-benar dijaga. | Dua gerbang sekarang: keanggotaan di toko INI, dan rank `owner` bila targetnya seorang owner. |
| 12 | **Kode pos opsional di KEDUA belah checkout.** Kode pos dicetak di paket. | Diukur sebelum apa pun diubah: kode pos kosong **lolos form DAN `/api/public/order` menulis pesanan**. ⚠️ Dan `required` saja akan jadi **no-op senyap**: field-nya `readOnly` persis di dua cabang yang mengisinya otomatis, dan input readonly **dikecualikan dari constraint validation** — `willValidate: false`, `valueMissing` tidak pernah menyala (diukur di browser). Ditemukan berbarengan: pilih kecamatan A lalu B, dan kode pos A **55764** mendarat di pesanan yang dikirim ke Sewon (552), dibacakan balik oleh kartu "Kirim ke" seolah memang miliknya. | `postcodeError("")` mengembalikan pesan wajib (API sudah memanggilnya, jadi penolakannya independen), form dapat `required` + `MISSING.kodepos`, kunci `readOnly` **dilepas permanen**, dan satu penulis `setKodepos()` yang membersihkan custom validity. **128 assertion, 0 gagal**, browser sungguhan, en-US, click+type. |
| 13 | **22 tes ledger — kode yang memutuskan kapan penjualan jadi bisa dicairkan — tidak pernah dijalankan siapa pun.** Suite-nya skip kecuali developer kebetulan meng-export `TEST_DATABASE_URL` manual. Tidak ada CI di sini. | **Sebelum: 16 file lulus, 1 skip — 145 lulus, 22 skip. Sesudah: 22 file lulus — 182 lulus, 0 skip.** | `test/db-setup.ts` (vitest `globalSetup`) menurunkan `<DATABASE_URL>_test`, membuat DB-nya kalau belum ada, memigrasikannya ke head. Nama hasilnya **wajib** berakhir `_test` atau setup melempar. |

### 🟠 Serius — merchant melihat angka atau status yang salah

- **Guard yang membaca TEKS file, bukan KODE-nya — ditemukan SEMBILAN kali di sembilan guard berbeda,** salah satunya diperkenalkan oleh commit yang memperbaikinya di tempat lain. Contoh terukur: komentari `normalizeCart()` di `readCart()` — perbaikan yang menyelamatkan setiap cart yang sudah ada di browser pembeli — dan **7 dari 7 tes tetap hijau**. Hapus arm `case "lookbook"` yang asli, tanam `const doc = \`case "lookbook": …\`` — **5 lulus**. Komentari tiga baris `lengthCm/widthCm/heightCm` — **5/5 hijau** sementara kuotasi kembali ke berat-saja, yaitu bug Rp41.100 di atas, **dipulihkan dengan tiga garis miring**. Sekarang **sepuluh** guard `readFileSync` lewat `test/source-code.ts`; tidak ada penghapus komentar buatan tangan yang tersisa.
- **Direktori yang dilewati berdasarkan NAMA = titik buta yang sama dengan daftar file hardcoded.** Dua sapuan melewati direktori bernama `public`. `apps/<app>/public` itu gambar; **`apps/admin/app/api/public` itu PUBLIC API** — empat file rute yang tak terlihat oleh dua guard, selamanya. Dan instance terburuk dari kelas yang diburu `inventory-location` justru ada di salah satunya (temuan #10 di atas).
- **`fetch()` TIDAK BISA mengirim header `Host`.** undici menurunkannya dari URL dan membuang milik Anda diam-diam. Diukur di server yang sama: **curl -H Host → 200 · node:http → 200 · fetch → 404.** Storefront multi-tenant lewat Host, jadi tanpa header itu tidak ada tenant. Klaim inti `check-pixel-defer` — yang komentarnya sendiri sebut **THE DETERMINISTIC CLAIM** — sudah menghitung script di halaman 404 *"Toko tidak ditemukan"* **seumur hidupnya**. Lulus karena halamannya kosong.
- **Dua belas jangkar "hari ini" beku, satu di jalur TULIS.** `actions/articles.ts` menstempel `publishedAt = 2026-06-30`, dan karena `fields()` adalah replace penuh, menyimpan ulang artikel yang sudah terbit **memundurkan tanggalnya**. Dibuktikan terhadap Postgres asli, di-rollback: tiga penyimpanan artikel yang benar-benar terbit 2026-07-20 08:30 → **2026-06-30 setiap kali**. Wave 5 menemukan **empat lagi** yang terlewat, termasuk "Bulan Ini" yang harfiah `startsWith("2026-06")` — diverifikasi di browser pada 3 Agustus masih menampilkan Juni.
- **`createArticle` melakukan `blog!.id` atas hasil kosong.** Hanya seed yang menulis `blogs`, dan hanya untuk toko demo — jadi **tidak ada merchant yang onboard lewat `/daftar` atau super-admin yang pernah bisa menerbitkan artikel**. Crash di Simpan pertama. Di sebelahnya: picker Blog di editor adalah **kontrol mati** — `blog` tidak pernah ada di `ArticleInput`, jadi memindahkan artikel memunculkan toast sukses dan tidak memindahkan apa pun.
- **`pct()` adalah formatter DELTA, dipakai untuk bagian-dari-total.** Kartu "Status Toko" di super-admin membaca *"Ditangguhkan 5 **+83,3%**"* — tanda plus yang menyiratkan penangguhan sedang naik padahal tidak ada yang bergerak. Penyebutnya juga melewatkan toko VIP, jadi totalnya 6 sementara KPI di sebelahnya membaca "2 / 7".
- **Alamat demo tidak bisa mengirim paket.** Diukur di produksi: **50 pesanan tanpa `ship_address`, distrik, dan kode pos sama sekali; 108 dengan alamat di bawah 15 karakter; dan — predikat yang benar-benar menangkap sisanya — 160 tanpa satu digit pun**. Jalan tanpa nomor rumah, RT/RW, atau blok tidak bisa dijalani. **7 kecamatan berbeda untuk 219 pesanan → 88 kecamatan / 31 provinsi** setelah diperbaiki. 59 alamat yang benar-benar diketik dibiarkan — predikat itu **adalah** jaminan idempotensinya.
- **Cron billing membuang response body-nya sendiri**, jadi run yang tidak menagih apa-apa ter-log identik dengan yang sehat. Dan drift-nya lebih buruk dari "jamnya bergeser": **setiap redeploy memicu run billing seketika** — **13 deploy pada 2026-08-03, 18 pada 07-30, 24 pada 07-23** — sehingga `sleep 86400` hampir tidak pernah jadi pemicunya. **Jadwal billing = jadwal merge.** Dan 🔴 **tidak ada yang mengawasi ketiga sidecar**: watchdog L1 mengecualikannya berdasarkan nama.
- **Landing apex bilang produknya belum diluncurkan, tiga kali** — *"Segera hadir"*, *"Situsnya sedang disusun"*, dan lede *"Situsnya masih kami susun"* — sementara produknya live dan menagih merchant. Setiap penghapusan membawa bukti: *"Tinggal diaktifkan"* (ADR 0004 — merchant tidak punya sakelarnya), *"e-wallet"* (`seed.ts:1773` — DANA/OVO/ShopeePay/LinkAja/GoPay semuanya `enabled: false`), *"pajak sudah ikut dihitung"* (`schema.ts:1145` `taxEnabled.default(false)`), dan `© {year}` yang `getFullYear()` di build statis membeku pada waktu image dibuat.
- **`verify-migrations` buta terhadap entri yang dihapus.** Ia memeriksa jurnal terhadap dirinya sendiri, jadi tetap hijau sementara dua (lalu tiga) entri benar-benar hilang. Memutar ulang **79 revisi historis `_journal.json`** menghasilkan **88 tag pernah tercatat terhadap 86 hari ini**. Yang hilang termasuk `0046_good_dust` — yang membuat **produksi tidak pernah membuat tabel `kelurahan` dan `/api/public/ongkir` 500 di setiap checkout**. Dan kategori yang belum pernah dinamai: **dua file DIUBAH setelah diterapkan**, sehingga container dev permanen menjalankan SQL yang tidak lagi ada di branch ini.
- **`seed:recent` tidak bisa jalan di produksi** — ia menyeleksi kolom yang tidak dimiliki produksi, dan hijau di dev hanya karena drift `push`.

### 🟡 Kebersihan & performa — semua dengan angka

- **Palet pencarian mengunduh 91 KB original ke kotak 42 px.** Markup-nya dibangun di dalam string JavaScript, jadi tak terlihat oleh cek statis **maupun** cek browser kecuali paletnya dibuka. Diukur di 412/DPR2: **91.178 B → 9.956 B (−89%)**, untuk enam kotak 42×56 px (7,14× oversize). srcset-nya dibangun **di server** — mengirim manifes 5,2 KB ke setiap pengunjung demi enam baris di balik interaksi adalah regresi berbaju perbaikan. Rasionya **+762 B JSON untuk menghemat 81.222 B gambar ≈ 107:1**.
- **`Header.astro` merender tiga `<img>` telanjang di SETIAP halaman.** Diukur pada homepage dingin, HTTP sungguhan: **1440 DPR 1: 133.612 → 59.122 B (−55,8%)** · 1440 DPR 2 −19,1% · 412 DPR 1 −28,1% · 412 DPR 2 −7,0%.
- **Deskriptor `srcset` berbohong tentang 16 file.** Ke-75 sumber dibaca dengan sharp: `/hero/` 3 file 1920×1080 jujur; `/sections/` **dua-duanya salah** (over-claim 60% dan satu under-claim); `/products/` **56 file 800 px, 14 file 600 px** semuanya mendeklarasikan `800w`. Dan **14 itu persis `<handle>.webp` setiap produk** — gambar PERTAMA, yang muncul di setiap kartu, setiap thumbnail mega-menu, dan setiap PDP. Dampak byte hari ini **0** — ini kejujuran, bukan penghematan.
- **Rating bintang adalah 30% DOM homepage.** `Stars.astro` menggambar tiap rating sebagai 2 lapis × 5 `<svg>` terpisah = 26 elemen, dua belas kali per halaman. Satu `<svg>` per lapis dengan lima `<path>` = 17. **1023 → 915 elemen.** Diverifikasi A/B piksel atas 40 widget: byte-identik di DPR 1 dan 2.
- **PDP thumbnail tidak punya srcset sama sekali**: **DPR 1 153.940 → 30.782 B (−80,0%)**, DPR 2 −71,9%.
- **Pixel marketing adalah biaya dominan** dan sekarang ditunda ke interaksi pertama: Meta + Google + TikTok menurunkan mobile **90 → 66** dan TBT **130 ms → 770 ms**. Unduhannya tidak pernah jadi masalah — semuanya sudah `async`; biayanya PARSE + EXECUTE di main thread.
- **Inter di-host sendiri.** Link Google Fonts render-blocking **1.409 ms** di tiga layout, di depan LCP yang **82% render delay**.

---

## Bagian 2 — Yang masih terbuka, dan harganya

Diambil lengkap dari `specs/docs/tasks/NEXT.md`. Tidak ada yang dilunakkan.

### Terkunci di Paduka Ongki (tidak ada orang lain yang bisa)

| # | Item | Harga kalau dibiarkan |
|---|---|---|
| **N1** | **Token impersonasi — jalur pengambilalihan akun ke merchant mana pun.** `L` | Tiga anggota badan masih ada: **replayable** dalam jendela 2 menit, **numpang query string** (jadi masuk log, header `Referer`, dan riwayat browser), dan **mencetak sesi 7 hari** yang hidup lebih lama dari `platform_session` operatornya. Sesi yang dicetak **tidak membawa penanda impersonasi sama sekali** — tidak ada `aud`, tidak ada id operator — jadi **setiap tindakan selama sesi itu diatribusikan ke merchant**. ✅ Satu hal berubah: rotasi password sekarang **mematikan** sesi itu (0087). Itu menutup satu tuas, **bukan** satu pun dari tiga anggota badan di atas. **URL yang bocor tetap sama dengan akun merchant.** |
| **N2** | **Dua setelan zona Cloudflare — disetujui 2026-08-01, prosedur ditulis, belum dikerjakan.** `S` | Email Obfuscation menyuntikkan `email-decode.min.js` **render-blocking, terukur 1.621 ms** — pemblokir terbesar tunggal di halaman, dipicu oleh link `mailto:` kita sendiri. ✔ Dikonfirmasi **masih ON pada 2026-08-01**. Tidak bisa dikerjakan dari repo: wrangler auth kedaluwarsa dan ini setelan zona, bukan Workers. |
| **N29** | **Password yang di-seed masih bisa dipakai login.** `S` | `tokophi123` tidak lagi *diterbitkan*, tapi masih kredensial ter-seed di setiap deployment yang sudah ada. Merotasinya menyentuh seed, dan **seed bukan migrasi** — jadi butuh data fix yang dinyatakan di commit body, karena tidak ada hal lain yang akan menerapkannya. |
| **N16** | **`tokophi_app` memegang DML penuh di tabel platform, dengan RLS mati.** `M` | `platform_cod`, `platform_couriers`, `platform_payout`, `platform_payment_channels`, `plans` writable oleh role tenant tanpa policy — dan policy `stores` adalah `FOR ALL`, jadi role tenant bisa UPDATE `comped` / `status` / `trial_ends_at` miliknya sendiri. **Merchant bisa menggratiskan dirinya sendiri.** Laten hari ini; **jadi hidup saat JWT merchant menyetir role itu — yang persis arsitektur produksi yang dinyatakan** (PostgREST sebagai `tokophi_app`). |
| **N18b** | **Pintu login — premis entri ini SALAH, dan ini keputusan.** | Limiter per-IP **sudah ada** di kedua panel sejak 2026-07-16. Yang benar-benar absen: (1) penghitungnya `Map` per-proses, reset tiap redeploy, tidak lintas replika; (2) menghitung IP, **bukan akun**; (3) **failed login tidak dicatat di mana pun** — nobody bisa menjawab "apakah merchant saya sedang diserang?"; (4) pintu di sebelahnya **tanpa throttle sama sekali**: `registerStore`, callback Google OAuth, dan `/impersonate` — GET tanpa autentikasi yang menukar token jadi sesi 7 hari. **Itu sebabnya N18b tidak bisa diputuskan sebelum N1.** |
| **N28** | **7 layar super-admin belum pernah di-crawl.** `S` | Routing dan gating **sudah** terverifikasi (ketujuh rute 307 ke login tanpa auth). Layarnya sendiri belum pernah dijalankan: butuh kredensial platform, dan sejak `#133` password operator dicetak acak dan ditampilkan sekali — jadi mendapatkannya berarti **me-reset password control-plane di DB bersama**. Bukan keputusan sepihak. |

### Terbuka dan bisa dikerjakan

| # | Item | Ukuran | Harga |
|---|---|---|---|
| **N33** | Seed menulis dimensi `1×1×1 cm`, **dan BOOKING mengirimkannya** | `S` | Tidak berbahaya untuk kuotasi (0,17 g volumetrik tidak pernah menang) tapi itu **juga yang dideklarasikan `createShipment` ke kurir**. Kurir mengukur ulang saat pickup; merchant ditagih selisihnya. Placeholder yang *masuk akal* lebih buruk dari kosong. |
| **N31** | Biaya COD yang ditagih KiriminAja tidak pernah dibaca | `S` | Setiap hasil `shipping_price` membawa `setting.cod_fee`, `minimum_cod_fee`, dan `cod_fee_amount` (terukur ada di keempat layanan sandbox). `grep -rn "cod_fee"` di `apps/` + `packages/` **tidak mengembalikan apa pun**. Merchant melihat ongkir tapi tidak biaya COD yang dipotong dari payout-nya. Bukan bug kebenaran — angka yang kita **punya** dan tidak kita tampilkan. |
| **N35** | Menampilkan environment KiriminAja mana yang sedang aktif | `S` | 🔵 Ruling Paduka: API **sama** di sandbox dan produksi — cutover cuma tukar endpoint. **Justru karena identik**, booking sandbox mengembalikan `kaOrderId` dan `pickup_number` berbentuk persis seperti produksi (terukur: `5758-E2E68072665` / `XID-5544692486`), dan **tidak ada apa pun di layar yang membedakannya**. Deploy yang salah endpoint terbaca sempurna sehat: pesanan berbunyi "dibooking", resi muncul, **dan tidak ada kurir yang datang**. `KIRIMINAJA_ENV` default **sandbox**, jadi *unset* adalah yang salah. |
| **N13** | Sitemap `<lastmod>` untuk produk + kategori | `M` (bukan `S`) | 🔴 **`products.updated_at` TIDAK ADA** — entri ini mengklaim ada. `products` hanya punya `created_at`, dan `collections` **tidak punya kolom timestamp sama sekali**. Terblokir di keputusan skema, bukan editan sitemap. |
| **N25** | `color_palettes` tabel yatim; jurnal pernah kehilangan entri | `S` | Container dev melaporkan 78 tabel di mana `schema.ts` punya 77, dan 92 baris di `__drizzle_migrations` terhadap 86 entri jurnal — selisih yang ikut terlipat ke setiap hitungan yang dikutip siapa pun. |
| **N8** | Backfill `orders.ship_district_id` | 🔴 **JANGAN MULAI** | Premisnya palsu: "77 baris di produksi" adalah hitungan **DEV**. Produksi punya **75 pesanan total dan 65 null, dan tidak satu pun punya `ship_postcode`**. Setiap penurunan yang disebut tugas ini menghasilkan **nol baris** di sana. Dan **62 kode pos dev dipalsukan oleh seed** (`POST_OF[city]` + 3 digit acak), **59 di antaranya tidak ada di `kelurahan` sama sekali** — mem-backfill dari situ akan menulis kecamatan yang salah dengan percaya diri **dan membungkam `destinationGuessed`**, jelas lebih buruk daripada NULL. |
| **N3 · N4 · N5 · N7** | Performa | **keputusan, bukan kerja** | Semua sudah diukur sampai habis. Lihat Bagian 3. |

---

## Bagian 3 — Yang sengaja TIDAK dikerjakan, dan alasannya

Ini sama berharganya dengan perbaikannya. Setiap satu mencegah sesi berikutnya membangun ulang sesuatu yang sudah ditolak dengan bukti.

| Ditolak | Alasan, dengan angkanya |
|---|---|
| **`requestIdleCallback` untuk menunda pixel** | Diukur (keputusan Paduka 2026-08-01): dengan `rIC`, browser idle di ~2 s dan **ketiga bundle tetap eksekusi di dalam jendela TBT Lighthouse** — mobile mentok **75**, TBT **690 ms**, 600 ms di antaranya pihak ketiga. Interaksi pertama + backstop 10 s adalah yang bekerja. Biayanya diterima sadar: pengunjung yang mendarat dan pergi dalam 10 s tanpa menyentuh halaman **tidak pernah** terhitung PageView. Atribusi revenue **tidak** terpengaruh — konversi dibangun dari BARIS PESANAN di server (ADR 0012). |
| **Mengubah `admin` jadi allow-list** (RBAC) | Itu menukar *pemberian* senyap dengan **PENCABUTAN** senyap, yang lebih sulit didiagnosis: `useCan` menyembunyikan kontrolnya, jadi admin tidak dapat error — tombolnya sekadar **tidak ada**, dan tidak ada yang bisa menjelaskan kenapa. Sebagai gantinya sensus `Record<Capability, "owner-only" \| "admin-too">` yang mengunci **kedua arah**, gagal di `tsc` *dan* `vitest`. Divalidasi dengan **merusaknya sengaja**: kapabilitas baru yang ditambahkan ceroboh membuat sensus merah, 2 dari 4 tes gagal. |
| **Mewajibkan kelurahan di checkout** | **4,2% distrik KiriminAja tidak punya baris kelurahan sama sekali**, jadi mewajibkannya tidak bisa diisi. Id tabel lokal adalah kode BPS (`34.02.13.2004`), membawa `id: null` **dengan sengaja**, dan **tidak bookable** — id yang salah membooking paket ke desa yang salah. Yang kita butuhkan darinya adalah **kode pos**-nya, dan itu sekarang ditangkap langsung. |
| **Menyanitasi HTML landing page dengan regex** | `<script>` adalah vektor yang jelas; `onerror=`, `javascript:` di `href`, `<iframe srcdoc>`, dan event handler SVG bukan. Strip parsial akan **memulihkan persis rasa aman palsu** yang sudah pernah diberikan caption itu. Yang dilakukan: eskalasi ke kapabilitas `landing:html` **owner-only**, dan captionnya diubah untuk mengatakan yang sebenarnya (`set:html` **memang mengeksekusi**). |
| **Cron untuk mengisi `analytics_daily`** | Cron adalah satu lagi hal yang berhenti diam-diam, dan **cron yang berhenti mereproduksi bug ini persis sambil terlihat seperti software yang sehat**. Repo ini sudah pernah membayar pelajaran itu: `verify-rls` merah berminggu-minggu, `check-pixel-defer` mengukur halaman 404. View juga ditolak: kesegaran sama, tapi butuh migrasi destruktif dan mengubah cerita RLS. |
| **Menaikkan/menurunkan build target** untuk `unused-javascript` | Client build **sudah** `esnext` (Astro hard-code-nya), tidak ada browserslist di repo, dan `dist/client` berisi **nol file `.js`**. Delta terukur dari perubahan build target: **0 byte**. 44 KiB dan 12 KiB itu **`fbevents.js` milik Meta** — 188,8 KB unused dari 394,5 KB (47,9%), yang mem-bundle **core-js 3.32.2**, tanda tangan persis yang dideteksi audit `legacy-javascript`. |
| **Menunda slide 2..n carousel** untuk `dom-size` | Seluruh hero cuma **106 elemen**. Itu tidak akan pernah membayar risiko crawler/no-JS. Dan memotong section di template DEFAULT adalah **nol delta secara konstruksi** — seed bukan migrasi, jadi hanya menjangkau toko baru. Yang sebenarnya besar: rating bintang, dan itu **sudah di lantainya** (fill-nya CSS supaya rating mengikuti warna brand merchant). |
| **Menghapus `scroll` dari pemicu pixel** (N7) | Tiga run mobile: TBT berayun **0 → 395 ms dengan NOL bundle vendor termuat**. Scroll Lighthouse tidak memicunya. Jadi menghapusnya akan **membayar biaya tracking sungguhan dan tidak membeli apa pun**. |
| **Membandingkan skor desktop 99 vs 84 yang lama** | Mesin berbeda, hari berbeda, populasi tidak sebanding. 15 run: median **99**, rentang **55–100**, TBT **0 ms di kelimabelasnya**, byte dan jumlah request **identik setiap run**. **Pearson r(skor, RTT) = −0,866** — skor desktop adalah proksi kualitas koneksi mesin pengukur, bukan build. |
| **Mengejar Speed Index 7,1 s** | Penyebabnya autoplay hero carousel — SI menilai setiap frame terhadap frame **terakhir**. A/B satu flag Chrome: autoplay ON **SI 7,96 s**, OFF **1,87 s**, **LCP tidak berubah**. Halaman memang selesai pada 1,8 s. Mengejar angkanya berarti menunda cross-fade melewati jendela audit — membeli skor dengan carousel yang terasa mati. |
| **Menulis ADR 0010 (courier policy)** | ADR itu akan **membangkitkan kembali kurasi yang sudah dibalik secara sadar** — roster hidup adalah API KiriminAja. Referensinya sekarang mengatakan ADR-nya tidak pernah ditulis. |
| **Sanity check "sandbox vs produksi"** untuk KiriminAja | 🔵 Ruling Paduka: API-nya identik. Jangan tulis parity check, jangan anggarkan perbedaan API di cutover. |
| **Menulis Terms of Service otomatis** | Menyusun kontrak dengan merchant yang **sudah ditagih** bukan sesuatu untuk di-autocomplete. Dan bukan itu yang membuka review iklan — privasi, identitas, dan kontak yang membukanya. |
| **Mengarang identitas perusahaan** | `identity.ts` membaca empat build var **tanpa default, dengan sengaja**. Placeholder yang dirender sebagai teks **ADALAH klaim yang diterbitkan** — pembaca tidak bisa membedakannya dari yang asli. Selama kosong, kedua halaman menampilkan notice yang menyebut persis apa yang kurang. |
| **Membuat `stores.status` jadi otoritatif** untuk suspend | Read layer sengaja tidak mempercayai kolom itu ("lifecycle real-time, bukan kolom tersimpan yang mungkin basi"), jadi trial yang habis siang hari akan tetap terbaca "trial" sampai run malam — memperkenalkan ulang bug kebasian yang sudah diperbaiki, demi fakta yang tetap tidak bisa mengatakan **KENAPA**. |
| **Merotasi setiap owner toko** setelah temuan `tokophi123` | `toko-tes` — satu-satunya user self-serve sungguhan — **tidak terdampak**. Skrip "rotate semua" akan menyapunya untuk memperbaiki masalah yang tidak dia punya. **Rotasi akun yang diukur, jangan rotasi tabelnya.** |
| **Break bersih yang mengeluarkan semua merchant** saat deploy 0087 | Satu baris di migrasi, dan itu akan sign-out setiap merchant yang sedang login. **Tidak diambil — Paduka yang memilih.** Residualnya terbatas: password yang dirotasi **sebelum** deploy ini tidak mencabut sesi yang dicetak sebelumnya, dan itu tertutup permanen per user pada rotasi pertama mereka setelahnya. |

---

## Bagian 4 — Keputusan yang menunggu Paduka Ongki

Ditulis sebagai **pertanyaan dengan trade-off**, bukan sebagai tugas.

### ① Token impersonasi (N1) — mana yang Paduka pilih, dan apa yang rela dibayar?

Hari ini satu URL yang bocor **adalah** akun merchant, dan setiap tindakan selama sesi itu tercatat
atas nama merchant, bukan operator.

| Opsi | Yang diperbaiki | Yang dibayar |
|---|---|---|
| **Sekali pakai** (dikonsumsi saat ditebus) | Replay dalam jendela 2 menit | Operator yang refresh halaman kehilangan sesinya; butuh alur "minta lagi" |
| **POST + body**, bukan query string | Bocor lewat log, `Referer`, riwayat browser | Tidak bisa lagi sekadar menempel link; butuh form/redirect |
| **Ikat expiry ke `platform_session` operator** | Sesi 7 hari yang hidup lebih lama dari operatornya | Impersonasi mati saat shift operator berakhir — mungkin di tengah pekerjaan |
| **Tandai sesinya sebagai impersonasi** | Atribusi: audit trail berhenti berbohong | Setiap pembaca sesi harus tahu penandanya; ini yang paling menyentuh banyak file |
| **Semuanya** | Ketiganya + atribusi | Satu hari kerja penuh, dan alur operator berubah |

**Yang perlu Paduka putuskan:** apakah operator boleh kehilangan sesi impersonasi di tengah jalan
demi menutup jalur ini? Kalau ya, "semuanya". Kalau tidak, minimal **sekali-pakai + penanda**.

### ② Dua setelan zona Cloudflare (N2) — sudah disetujui, siapa yang menekan tombolnya?

Prosedur, padanan API, dan perintah verifikasinya sudah ditulis lengkap di `specs/docs/CLOUDFLARE-PERF.md`.
Tidak bisa dari repo ini: token Cloudflare **tidak punya izin ruleset** dan auth wrangler kedaluwarsa.

- **Email Obfuscation → Off** membeli kembali **1.621 ms** render-blocking. Biayanya: alamat `mailto:`
  kita tidak lagi disamarkan dari scraper.
- **Cache Rules aset statis.** ⚠️ `/products/*.webp` dan gambar SUMBER lain **tidak boleh** `immutable` —
  merchant yang mengganti foto memakai nama file yang sama, dan kita tidak bisa purge sesuatu yang sudah
  kita bilang tidak pernah berubah.

**Yang perlu Paduka putuskan:** memperbarui token Cloudflare (supaya agent bisa melakukannya), atau
mengeksekusinya sendiri dari dashboard.

### ③ `tokophi_app` punya DML di tabel platform (N16) — ini keputusan SEBELUM cutover VPS

Merchant bisa meng-UPDATE `comped`/`status`/`trial_ends_at` toko sendiri begitu JWT merchant menyetir
role itu — dan itu **persis** arsitektur produksi yang direncanakan (PostgREST sebagai `tokophi_app`).

| Opsi | Konsekuensi |
|---|---|
| Pindahkan tabel platform ke role yang tidak bisa dijangkau tenant | Paling bersih; butuh satu migrasi grant + review |
| Persempit grant-nya jadi `SELECT` saja | Lebih kecil; tapi super-admin tetap butuh jalur tulis sendiri |
| Cutover tetap menaruh semua tulis di belakang app Next | Paling murah sekarang; **membatasi apa yang boleh jadi PostgREST selamanya** |

**Yang perlu Paduka putuskan:** apakah PostgREST akan pernah melayani tulis langsung? Jawaban itu yang
memilih opsinya, dan menjawabnya sekarang lebih murah daripada setelah cutover.

### ④ Identitas legal landing page + review pengacara

`PUBLIC_LEGAL_NAME`, `PUBLIC_LEGAL_ADDRESS`, `PUBLIC_CONTACT_EMAIL`, `PUBLIC_CONTACT_WHATSAPP`
**tidak di-set di mana pun di repo** — `docker-compose.coolify.yml` tidak mengirim satu pun build arg ke
service `landing` **[DIUKUR]**. Jadi apex hari ini menampilkan notice *"Halaman ini belum lengkap"* di
`/kontak` dan `/privasi`, dan `/privasi` mendiskualifikasi dirinya sendiri sebagai pemberitahuan resmi.

Yang masih menunggu Paduka:
1. **Isi keempat var itu di Coolify** — notice hilang tanpa perubahan kode.
2. **Review pengacara** untuk `/privasi` dan `/kontak`.
3. **Tetapkan periode retensi data** — §6 di `/privasi` kualitatif karena **tidak ada satu periode pun
   yang didefinisikan di repo ini**.
4. **Putuskan apakah UU PDP mewajibkan menyebut processor pengiriman dan pembayaran** — ini
   **BERTABRAKAN** dengan aturan label generik ADR 0004 (brand provider disembunyikan dari klien).
   Dua aturan ini tidak bisa keduanya benar; salah satu harus mengalah, dan itu keputusan hukum.
5. **Konfirmasi dasar transfer lintas batas** untuk hosting Singapura.
6. **Terms of Service dan kebijakan refund tidak ada** — untuk langganan berulang berbayar. Tidak ada
   link yang 404 (memang tidak pernah ditautkan), tapi tidak adanya juga adalah keadaan yang sedang jalan.

### ⑤ N29 — rotasi `tokophi123` di deployment yang sudah ada

`tokophi123` tidak lagi diterbitkan, tapi **7 dari 8 owner produksi masih verify terhadapnya**, plus
`admin@tokophi.id` — satu-satunya baris `platform_admins`, dan yang paling mendesak sekaligus paling
sulit: `invitePlatformAdmin` adalah **satu-satunya tulis ke `platform_admins` di seluruh app** (satu
INSERT, tanpa UPDATE, tanpa DELETE), jadi tidak ada `resetOwnerPassword` untuknya. Runbook-nya sudah
ditulis (`specs/docs/tasks/2026-08-03-rotate-exposed-owners.md`) dan **sengaja belum dieksekusi**.

Tiga fakta yang mengubah arti "rotasi": rotasi **tidak** mengakhiri sesi hidup yang dicetak sebelum
migrasi 0087; dialog reveal adalah **satu-satunya salinan password yang akan pernah ada**; dan
**"apakah ini pernah dieksploitasi?" TIDAK BISA DIJAWAB** — tidak ada catatan failed login di mana pun,
jadi harus dilaporkan sebagai *tidak terobservasi*, tidak pernah sebagai "tidak ada bukti kompromi".

**Yang perlu Paduka putuskan:** jalankan runbook itu sekarang, atau tunda sampai N1 diputuskan?

---

## Bagian 5 — Wave 7: audit atas yang belum pernah diaudit

Enam gelombang sebelumnya berkonsentrasi di checkout, uang, password, RLS, performa storefront, dan
super-admin. Gelombang ini menyapu yang tersisa: **`apps/landing`**, **jalur error & empty state di
panel Seller**, **permukaan API publik**, **drift seed vs produksi**, **jangkar tanggal di jalur tulis**,
dan **aksesibilitas di luar checkout**.

> **Label bukti.** **`[DIUKUR]`** = saya menjalankan sesuatu dan ini keluarannya. **`[DIBACA]`** = saya
> membaca kodenya baris per baris dan yakin, tapi saya tidak menjalankan hal yang membuktikannya.
> Membedakan dua ini adalah satu-satunya hal yang mencegah audit jadi opini berbaju angka.

### 🔴 Tinggi

#### W1. Empat rute publik mengambil TENANT dari BODY, dan dua di antaranya adalah oracle lintas-toko

`/api/public/{ongkir,order,promo}` semuanya me-resolve toko dari **field body `storeSlug`**, bukan dari
header `Host`. Slug itu publik (ia adalah hostname storefront). **[DIBACA]** — `promo/route.ts:31-34`,
`order/route.ts:192-199`, `ongkir/route.ts:81-88`.

Kontrasnya sudah ada di repo ini dan **dinyatakan sebagai aturan**: setiap endpoint storefront
me-resolve toko dari header `Host` dan menolak membaca id toko dari body — `checkout-session.ts:13-15`
dan `track.ts:9-11` mengatakannya harfiah, dan `search.ts:3-5` menjelaskan kenapa (*"id toko di query
string akan membuat palet satu toko membaca katalog toko lain"*). **[DIBACA]**

Konsekuensi yang paling tajam, dan ini yang baru:

- **`/api/public/promo` adalah oracle voucher lintas-toko, tanpa efek samping, 30/menit per IP,
  `Access-Control-Allow-Origin: *`.** `applyDiscount` mengembalikan **enam pesan berbeda**: *"Kode
  voucher tidak ditemukan."* · *"…tidak aktif."* · *"Voucher belum berlaku."* · *"…sudah
  kedaluwarsa."* · *"Kuota voucher sudah habis."* · dan **`"Minimum belanja Rp{N} untuk voucher ini."`
  yang membocorkan ambang rupiahnya persis** (`lib/promo.ts:49-56`). **[DIBACA]** Sebut slug pesaing,
  tebak kodenya, dan Anda tahu kode mana yang ada, statusnya, jadwalnya, kuotanya habis atau belum, dan
  minimum belanjanya. `CLAUDE.md` sudah menandai risiko probe ini di bagian "Codes are unique PER
  STORE"; **rute inilah tempat ia bisa dijangkau anonim.**
- **`/api/public/order` membocorkan STOK HIDUP yang persis**: `` `Stok "${prod.title}" tidak mencukupi
  (sisa ${available}).` `` (`order/route.ts:321`), satu varian per permintaan, 10/menit per IP, terhadap
  slug mana pun. **[DIBACA]**

⚠️ Limiter-nya `Map` per-proses dan di-key pada IP yang **diturunkan dari header** (`public-guard.ts:5-8`
membaca `x-forwarded-for` bila `cf-connecting-ip` tidak ada). Reset tiap redeploy — dan Bagian 1 sudah
mengukur bahwa redeploy terjadi **13–24 kali sehari**.

#### W2. `npm test` MELEWATI 22 tes uang di dalam worktree — dan worktree adalah alur kerja yang diwajibkan

Ini adalah pelajaran wave 2 yang kembali lewat pintu lain. **[DIUKUR]**, di worktree ini:

```
npm test  →  ┌──────────────────────────────────────────────────────────┐
             │ DB-COUPLED SUITES SKIPPED — the ledger/money tests did    │
             │ NOT run.  No DATABASE_URL (env or root .env)              │
             └──────────────────────────────────────────────────────────┘
             Test Files  36 passed | 3 skipped (39)
             Tests      263 passed | 36 skipped (299)      exit 0
```

Dengan `DATABASE_URL` diekspor, di worktree yang sama, tanpa perubahan kode: **39 file lulus, 299 tes
lulus, 0 skip** — termasuk `ledger-credit.test.ts` (22 tes). **[DIUKUR]**

Sebabnya struktural: `.gitignore:8` adalah `.env*`, jadi sebuah worktree **tidak akan pernah** punya
root `.env` dari git. Dan `test/db-setup.ts:33` hanya membaca `path.join(ROOT, ".env")` — root worktree
itu sendiri — lalu berhenti.

🔴 **Repo ini sudah memecahkan masalah ini, dua kali, di tempat lain.**
`apps/storefront/scripts/check-env.mjs:84-91` membaca **kedua** file, dan komentarnya menyebut alasannya
kata per kata: *"because a worktree lives at `<main>/.claude/worktrees/<name>` and `.env` is gitignored,
so a worktree never has one — the main checkout's."* Sebelas skrip `packages/db` melakukan hal yang sama
lewat `dotenv -e ../../.env -e ../../../../../.env`. **Tiga implementasi; yang tidak tahu tentang
worktree adalah yang menjaga tes uang.** **[DIUKUR]**

Seberapa sering ini menggigit: dari **30 worktree** di mesin ini, **3 tidak punya root `.env`** —
termasuk dua dari tiga worktree wave-7 yang dibuat hari ini. **[DIUKUR]** Jadi penyalinan env biasanya
berhasil; saat gagal, **kegagalannya senyap dan hijau**. `npm run test:db` memang gagal keras dan
menyebutkan alasannya dengan benar **[DIUKUR]** — tapi `CLAUDE.md` menyebut `npm test` lebih dulu, dan
tidak ada CI yang menjalankan salah satunya.

#### W3. Tidak ada batas ukuran body maupun panjang array di rute publik mana pun

`/api/public/order` menyaring `items[]` (`route.ts:151`) tapi **tidak pernah memotongnya**, lalu
melakukan sekitar **empat round-trip DB per elemen** sebelum transaksi dimulai. `/api/public/ongkir`
meneruskan `body.items` apa adanya ke `weightForCart`, yang membangun `inArray` sepanjang itu.
`next.config.ts` tidak menetapkan batas body. **[DIUKUR — grep `slice(`/`length >`/`MAX_` di keempat
rute; satu-satunya `slice` pada input adalah `sessionId.slice(0, 64)`.]**

Pembandingnya ada di repo yang sama: `apps/storefront/src/pages/api/checkout-session.ts:109` memotong
`v.slice(0, 50)` — dan file itu hanya **mencatat** keranjang yang tidak akan pernah ditagihnya.
**Endpoint yang mengubah keranjang itu jadi uang dan stok tidak memotong apa pun.** **[DIUKUR]**

Sama: **tidak ada bot gate di keempat rute publik admin**, sementara `checkout-session.ts` dan
`track.ts` — insert analitik yang sengaja gagal-diam — dijaga regex UA 40+ pola. **[DIUKUR — grep
`BOT_UA` di `apps/admin/app/api/public/` mengembalikan nol.]**

#### W4. Pesan mentah dari provider dikembalikan apa adanya ke pembeli anonim

Rantainya utuh dan saya menelusurinya baris per baris **[DIUKUR — dibaca di setiap hop]**:

```
kiriminaja.ts:94   return { ok:false, results:[], error: r.text }      ← teks vendor
shipping-quote.ts:176  return { ok:false, error: r.error ?? "…" }
ongkir/route.ts:111    NextResponse.json({ ok:false, error: q.error })  ← ke pembeli
order/route.ts:474     bad(quote.error, "shipping")                     ← ke pembeli

autolaris.ts:116   return { ok:false, error: r.ket ?? `Gagal (rc=${r.rc})` }
order/route.ts:859     NextResponse.json({ …, payError: pay.error })    ← ke pembeli
```

**[BELUM DIUKUR]** — apakah string error provider yang sungguhan menyebut nama brand-nya. Yang pasti:
itu taksonomi error internal vendor, di layar pembeli, di produk yang aturannya (ADR 0004) adalah brand
provider disembunyikan dari klien. Wave 5 sudah memperbaiki kelas yang sama untuk `cancelShipment` —
menolak **sebelum** panggilan jaringan dan menyebut langkah berikutnya *alih-alih mengutip vendor*.
Jalur throw sudah benar (string Bahasa tetap); yang bocor adalah jalur `{ok:false}`.

#### W5. `kpi-card.tsx` menulis `NaN` harfiah ke atribut `d` sebuah `<path>` SVG

**[DIUKUR]** — saya menjalankan ekspresi persis dari `apps/admin/components/admin/kpi-card.tsx:10`
dengan satu titik data:

```
kpi-card sparkline, 1 point -> d = MNaN,30.0
```

Penjaganya di baris 7 adalah `if (!data.length) return null` — itu menangkap kasus **kosong**, bukan
kasus **satu titik**, dan `i / (data.length - 1)` adalah `0 / 0`.

Dapat dijangkau: `/analitik` rentang **"Bulan Ini"** memakai `inMonth(thisMonth)`
(`dashboard.ts:56`, `:45`), dan deret `getDailyStats` rapat sampai hari ini — jadi **pada tanggal 1
setiap bulan rentang itu menghasilkan tepat satu `DayPoint`** dan `getSeries` mengembalikan satu
`points` (`dashboard.ts:129-132`). Keempat sparkline KPI di layar itu diberi makan dari `points`
(`analitik-client.tsx:62-64, 74-79`). **[DIUKUR — dibaca di setiap hop.]**

🔴 **Fungsi yang sama, byte-identik, satu direktori di sebelahnya, SUDAH dijaga.**
`apps/admin/components/admin/dashboard/money-strip.tsx:26` berbunyi `if (data.length < 2) return null`.
Dua salinan satu fungsi; yang di dashboard benar, yang di `/analitik` tidak. **[DIUKUR]**

#### W6. `packages/lib/src/format.ts` tidak punya penjaga non-finite sama sekali

**[DIUKUR]** — saya menjalankan keempat formatter yang diekspor:

| input | `IDR` | `IDR({compact})` | `num` | `pct` | `share` |
|---|---|---|---|---|---|
| `NaN` | `RpNaN` | `RpNaN` | `NaN` | `NaN%` | `NaN%` |
| `Infinity` | `Rp∞` | **`RpInfinity M`** | `∞` | `+Infinity%` | `Infinity%` |
| `-Infinity` | `-Rp∞` | `-Rp∞` | `-∞` | `−Infinity%` | `-Infinity%` |

Artinya: **sekitar 30 penjaga pembagian yang ditulis tangan adalah satu-satunya yang berdiri antara
merchant dan `RpNaN`** — dan W5 membuktikan disiplin itu sudah pernah lepas sekali. `pct(NaN)` bahkan
kehilangan tandanya, karena `n > 0` dan `n < 0` dua-duanya salah untuk `NaN`.

### 🟠 Menengah

#### W7. Drift seed yang tidak pernah sampai ke toko yang sudah ada

"Seed bukan migrasi" sudah jadi aturan tertulis. Yang belum pernah dihitung: **berapa banyak yang
tertinggal.** Yang punya konsekuensi hidup:

| Yang berubah di seed | Kapan | Yang dialami toko lama |
|---|---|---|
| `platform_couriers.services` **ganti dialek** — dari `["REG","BEST"]` jadi objek `{type,name,group,cod,codAllowed}` | 2026-07-14 | Ini **singleton platform**. DB yang pertama kali di-seed sebelum tanggal itu tidak punya `codAllowed` sama sekali ⇒ **mata rantai kedua COD gagal ⇒ COD mati se-platform**, dan kunci `"<courier>:<service_type>"` di `/api/public/ongkir` tidak akan pernah cocok. **[DIBACA — komentar seed `:1680-1685` menyatakannya. Container dev diukur ada di dialek BARU; produksi belum diperiksa.]** |
| `store_settings.sender_kecamatan_id` (asal ongkir) | 2026-07-14 | **6 dari 7 toko di DB dev tidak punya asal pickup sama sekali** **[DIUKUR — SELECT]**. Setiap kuotasi di toko itu jatuh ke pencocokan kabur nama kota dan mengembalikan `originFrom: "store-city"`. |
| `store_shipping_methods` (18 baris) | 2026-07-14 | Nol baris ⇒ fallback ke `store_settings.couriers`, yang **NULL di ketujuh toko** **[DIUKUR]** = "semua kurir yang dikembalikan KiriminAja". Jadi toko lama menawarkan Jagopack, BIGPACK, SiCepat CARGO di checkout — lubang persis yang ditutup `35b88a4`. |
| `reviews.product_id` | 2026-07-15 | Ulasan lama mendarat dengan `product_id = NULL`, jadi **tidak ada produk yang membawa rating**, dan **tidak ada migrasi yang mem-backfill-nya** **[DIBACA — grep seluruh `packages/db/drizzle/*.sql`]**. |
| `platform_payment_channels` (15 baris, 6 aktif) · `platform_payout` (singleton) | 2026-07-09 · 2026-07-14 | Keduanya singleton platform. DB yang lebih tua punya **nol opsi pembayaran di checkout**, dan kebijakan payout yang dirender super-admin tidak ada di DB. |
| `customer_addresses` | 2026-07-14 | Nol baris; halaman detail pesanan dulu menambal lubangnya dengan mengarang `Jl. Merdeka No. {hash % 90}`. |

✅ **Kelompok kontrol — perubahan seed yang MEMANG dapat migrasi**, dan ini contoh yang benar:
`payments.store_id` (`0036`, dengan `UPDATE … FROM orders`), penomoran produk (`0081` — kolom →
backfill → constraint → `INSERT INTO store_counters SELECT … FROM stores` untuk **setiap** toko yang
sudah ada), dan kanonikalisasi telepon `62…` (`0048`). **[DIBACA]**

#### W8. Keep-list truncate melindungi data REFERENSI, bukan konfigurasi operator

`seed.ts:672` menjaga `kiriminaja_areas`, `kelurahan`, `product_taxonomy` — ketiganya benar dan lengkap.
Yang **tidak** dilindungi, dan yang seed **tidak pernah kembalikan**: **[DIBACA]**

- **`store_tracking_channels`** — pixel ID + **ciphertext token CAPI** setiap toko. Seed **tidak pernah
  meng-insert tabel ini sama sekali**. `SEED_FORCE=1` menghapusnya tanpa jalur pemulihan apa pun.
  ⚠️ Dan satu baris di tabel itulah yang dibaca `check-pixel-defer.mjs`; nol baris = **SKIP**, jadi
  guard-nya berhenti menjaga tanpa suara.
- **`shipping_aggregator.api_key`** dan **`platform_payment_gateways.credentials`** — di-seed ulang
  jadi **NULL** (`seed.ts:1676-1679`).
- **`platform_admins`** — password operator yang sudah dirotasi kembali jadi `tokophi123`
  (`seed.ts:1557`).
- `page_templates` non-demo, `flash_sales` — hilang, tidak dikembalikan.

#### W9. Dua cacat hidup yang hanya hidup di commit body wave 6, dan tidak ada yang melacaknya

Commit `b5f9ded` menamai dua hal *"both real, both one surface up"*. **[DIUKUR — keduanya diverifikasi
di HEAD, dan `grep` atas `NEXT.md` + `BACKLOG.md` untuk keduanya mengembalikan NOL.]**

1. **`getPlatformSession()` mengembalikan payload JWT VERBATIM, tanpa satu pun pembacaan ulang DB.**
   `apps/super-admin/lib/platform-auth.ts:47-56` — `jwtVerify` lalu `return payload as PlatformSession`.
   Jadi **operator platform yang sudah diturunkan pangkatnya atau dihapus tetap memegang rank-nya
   selama 7 hari**, dan `platform_admins` tidak punya pencabutan apa pun. Ini **lebih buruk** daripada
   bug yang baru saja ditutup 0087 untuk merchant — di sana `getSession()` setidaknya membaca ulang
   keanggotaan.
2. **`addStoreUser` mengembalikan `password: pw` meski user-nya sudah ada dan hash-nya TIDAK ditulis.**
   `apps/super-admin/lib/actions.ts:729-738` — `pw` dicetak tanpa syarat di baris 729, tapi
   `hashPassword(pw)` hanya dijalankan di dalam `if (!u)`. Operator diberi password yang tidak bisa
   dipakai login, dan tidak ada yang mengatakan begitu.

**Temuan di balik temuan:** fakta yang hanya hidup di commit body adalah fakta yang tidak dibawa antrean.
`CLAUDE.md` sudah punya aturannya (*"Hand off in the repo, not in chat"*) — yang kurang adalah
"…**dan di `NEXT.md`, di commit yang sama**".

#### W10. Empty state: layar pertama yang dibuka merchant baru adalah yang paling kosong

**[DIBACA — grep tidak menemukan cabang panjang-nol di keempatnya]**

| layar | apa yang dilihat merchant tanpa data |
|---|---|
| Dashboard `/` → "Pesanan Terbaru" (`recent-orders.tsx:20`) | **Header tabel lengkap** (Pelanggan · Invoice · Channel · Status · Total) dengan **nol baris** di bawahnya. Itu lebih buruk dari kosong: header kolom menegaskan ada tabel untuk dibaca. |
| Dashboard `/` → "Aktivitas Langsung" (`live-activity.tsx:23`) | Judul kartu, lalu badan yang benar-benar kosong. |
| `/pelanggan/segmen` (`segmen-client.tsx:244`) | Strip ringkasan berbunyi *"**0** segmen aktif"*, lalu **grid kosong**. Satu-satunya jalan maju adalah tombol "Buat segmen" di header — yang **di-gate `crm:write`**, jadi user staf melihat halaman yang benar-benar kosong. |
| `/crm/template` (`template-client.tsx:349`) | Strip "Variabel tersedia" dirender tanpa syarat — dokumentasi untuk fitur yang tokonya belum punya satu pun instance — lalu ruang kosong. CTA-nya juga `crm:write`. |

Tujuh belas layar lain **punya** empty state, beberapa sangat bagus (`pesanan-client.tsx:436` bahkan
membedakan "belum ada pesanan" dari "tidak ada yang cocok dengan filter"). Tidak ada primitif
`EmptyState` bersama di `packages/ui` — setiap layar menuliskannya ulang, dan itulah kenapa cakupannya
tidak rata.

#### W11. Basis nol dilaporkan "+0,0%" dengan panah hijau ke atas

`apps/admin/lib/data/dashboard.ts:65` — `const delta = (cur, prev) => (prev === 0 ? 0 : …)`. Penjaganya
mencegah `Infinity`, tapi **mengembalikan `0` adalah klaim, bukan ketiadaan**. Merchant yang bulan
pertamanya Rp0 → Rp5jt membaca **"+0,0%"** di sebelah panah naik emerald, di setiap tile KPI `/` dan
`/analitik` (`kpi-card.tsx:41,51` memilih `up = delta >= 0`, jadi `0` dirender sebagai **kenaikan**).
**[DIUKUR — dibaca di kedua file.]**

Repo ini sudah tahu jawaban yang benar dan menerapkannya di tempat lain:
`app/(admin)/keuangan/page.tsx:27-28` mengembalikan `null` untuk basis nol dan merender
*"Belum ada periode pembanding."*, dengan komentar yang mengatakannya persis — *"With no prior period we
show nothing rather than '+100%' or '0%' — both of which would be inventions."*

#### W12. Aksesibilitas di luar checkout

**[DIUKUR — grep]**

- **`/produk` melompat h1 → h3.** `produk-client.tsx:402` adalah **satu-satunya tag heading di seluruh
  file** (`<h3>` untuk nama produk di kartu grid); `<h1>`-nya datang dari `PageHeader`. Tidak ada `<h2>`
  di mana pun. ⚠️ Dan repo ini sudah menuliskan aturannya **dua kali** di dua file lain —
  `pemasaran/feed-card.tsx:133` dan `navigasi/navigasi-client.tsx:704` keduanya berkomentar *"h2, not
  h3 — this page's only other heading is the page `<h1>`"*. Dua penulis menalarkannya dan benar; yang
  ketiga terlewat.
- **`/tema/[id]` tidak punya `<h1>` sama sekali di kode aplikasi.** `builder-client.tsx` berisi **nol**
  `<h1>`/`<h2>`/`<h3>`/`PageHeader` **[DIUKUR — `grep -c` = 0]**. Satu-satunya judul diserahkan ke
  `<Puck headerTitle=…>`, pihak ketiga.
- **Tiga tombol ikon DESTRUKTIF tanpa nama aksesibel**, semuanya di satu file:
  `promo/[id]/promo-editor-client.tsx:207` (hapus poin manfaat), `:230` (hapus chip "Ideal Untuk"), dan
  `:291` (hapus poin masalah). Ketiganya sekali klik, tanpa konfirmasi. Yang di `:230` paling tajam —
  label chip `{c}` berada di `<span>` **induknya**, di luar tombol, jadi tidak menyumbang apa pun ke
  nama aksesibelnya. Pembandingnya ada di `collection-editor.tsx:593`, yang melakukan pekerjaan
  identik dengan `aria-label={\`Hapus ${p.name}\`}`.

### 🟡 Rendah — tetapi kelasnya sudah pernah mahal di sini

- **W13. Sapuan kredensial hanya menyapu `apps/`.** `no-published-credentials.test.ts:25` —
  `const APPS = join(ROOT, "apps")`. Jadi **23 file `.astro`/`.tsx` di `packages/{sections,ui}` — markup
  yang benar-benar dikirim ke storefront merchant — berada di luar jangkauannya**, sementara
  `password.test.ts` di sebelahnya sudah menyapu `git ls-files` seluruh repo. **[DIUKUR — tidak ada
  kredensial di sana hari ini; grep bersih.]** Ini aturan *"jangan ikat guard ke daftar target"* yang
  sama, satu tingkat lebih atas.
- **W14. Ketiga sidecar cron mengirim `CRON_SECRET` di query string** (`docker-compose.coolify.yml:237,
  266, 290`), padahal ketiga rute juga menerima header `x-cron-secret`. **[DIUKUR]** Jaringan internal,
  jadi rendah — tapi `docker top` pada sidecar mencetak perintah dengan rahasianya sudah ter-ekspansi,
  dan itu persis cara wave 6 membuktikan loop billing masih hidup.
- **W15. `docker-compose.coolify.yml:173` masih menyebut landing *"currently 'segera hadir'"*** — kalimat
  persis yang dihapus wave 5 dari halamannya. **[DIUKUR]**
- **W16. Landing menyatakan "COD" begitu saja** (`index.astro:132`), bersebelahan dengan QRIS dan
  transfer bank yang memang menyala tanpa syarat — sementara `store_settings.cod_enabled` **default
  `false`** (`schema.ts:1213`), COD hanya SPX, dibatasi **Rp2.000.000** dan **6 provinsi**. **[DIUKUR]**
  Wave 5 memperbaiki klaim di klausa sebelumnya pada kalimat yang sama; ini yang tersisa.
- **W17. Tidak ada harga di mana pun di apex, dan tidak ada Syarat & Ketentuan maupun kebijakan refund**
  untuk langganan berulang berbayar. *"Gratis 3 hari"* — yang dibaca dari `BILLING.TRIAL_DAYS` jadi tidak
  bisa basi — adalah **satu-satunya pernyataan komersial di seluruh apex**; kelanjutannya (Rp50rb →
  Rp275rb/bln + PPN 11%) tidak pernah disebut. **[DIBACA]**
- **W18. Invarian a11y landing tidak punya guard.** `check-h1-floor.mjs` ber-scope tenant storefront;
  satu-satunya otomasi yang menyentuh `apps/landing` adalah `astro check` (typecheck) plus dua sapuan
  sumber. Satu `<h1>` per halaman, nol lompatan heading, nol `<img>` telanjang — semuanya benar hari ini
  dan dipegang **oleh konvensi saja**. **[DIBACA]**

### 🔵 Diperiksa dan BERSIH — supaya tidak ada yang mengejarnya lagi

- 🔴 **Tidak ada jangkar tanggal seed yang tersisa di jalur BACA maupun TULIS aplikasi mana pun.**
  Empat sapuan atas seluruh worktree (`2026-06-30`, `2026-07-02`, `TODAY|ADMIN_TODAY|ANCHOR`,
  `new Date("2026`): setiap hit di `apps/` adalah **komentar yang mencatat perbaikan yang sudah
  mendarat**, sebuah test, atau `lib/mock/store.ts`. Dan `TODAY` di mock itu **tidak pernah sampai ke
  runtime**: ke-30 situs `import … from "@/lib/mock/store"` adalah **type-only**. `createdAt` **tidak
  pernah** distempel eksplisit di kode aplikasi mana pun. **[DIUKUR]**
- **Keempat rute `/api/public/**` MEMANG dibatasi laju** — ongkir 60/mnt, order 10/mnt, promo 30/mnt,
  pay/callback 60/mnt per IP **[DIUKUR]**. Temuan wave 6 tentang "tak terlihat oleh dua guard" adalah
  soal sapuan sumber, bukan limiter. `pay/callback` **terautentikasi** dengan rahasia bersama
  `timingSafeEqual` dan **gagal-tertutup di produksi** bila rahasianya tidak di-set.
- **Ketiga rute cron mewajibkan `CRON_SECRET` dan MENOLAK di produksi bila tidak di-set** **[DIUKUR]**.
- **`apps/landing` menerbitkan nol kredensial**, nol form, nol `<img>`, satu `<h1>` per halaman, nol
  lompatan heading, nol link internal rusak, dan tidak menyatakan badan hukum yang mungkin tidak ada —
  keempat kalimat notice "belum lengkap"-nya justru mengatakan yang sebaliknya. Keempat komentar HTML
  yang tersaji ke browser tidak berbahaya. **[DIBACA — seluruh 19 file]**
- **Tidak ada badge status warna-saja di `apps/admin`** — keenam status pesanan dan kelima badge lain
  membawa label teks; warnanya redundan, yang benar. Ketigabelas `<img>` membawa `alt`. **17 dari 19**
  tombol ikon membawa `aria-label`, sebagian besar kontekstual (`Kurangi stok ${p.name}`). **[DIBACA]**
- **Sekitar 30 situs pembagian di admin + super-admin dijaga dengan benar** — daftar lengkapnya ada di
  transkrip audit; termasuk setiap rasio retur, corong, AOV, konversi, dan bagian channel.
- **Laporan HTML: TIDAK ADA.** `find` atas seluruh repo (di luar `node_modules`/`.git`) mengembalikan
  **nol** file `.html`. **[DIUKUR]** Tidak dibuat — itu keputusan yang belum diambil.

## Wave 8 — Pre-Release Production Readiness Audit (2026-08-16)

### Decision

TokoΦ is an advanced pre-release system, not yet ready for unrestricted production release. Core tenant/RBAC/backend invariants are substantial, but seven P0 failures can still produce unauthorized order acceptance, duplicate payable bills, fabricated inventory information, or UI success without a durable write.

This wave is a planning and evidence update only. No production data, deployment, payment, courier booking, payout, or remediation code was changed.

### Evidence executed

| Evidence | Result |
|---|---|
| Repository suite | 90/90 test files passed; 722/722 tests passed |
| DB-coupled suite | 90/90 test files and 722/722 tests passed against the dedicated local test database |
| Storefront Astro check | 0 errors |
| Landing Astro check | 0 errors |
| Local browser exercise | Seller login/dashboard; product list/editor; inventory; purchasing; navigation; active storefront home/list/PDP/cart/checkout; desktop and mobile samples |
| Tenant-state probe | Active tenant served; suspended tenant returned not found at storefront entry |
| Live read-only probe | `app.tokophi.com` returned HSTS; `tokophi.com` redirected to Cloudflare 404 |

Passing tests are baseline evidence, not release evidence for the missing contracts. The current suite does not cover the complete cart → order → payment callback → inventory/ledger lifecycle.

### Accepted findings

| Priority | Count | Release treatment |
|---|---:|---|
| P0 — release blockers | 7 | Must be fixed and reproduced green before unrestricted release |
| P1 — high priority | 8 | Must be fixed or explicitly deferred by an owner with release impact recorded |
| P2 — hardening | 6 | Scheduled after functional contracts; security items remain release-sensitive |

#### P0 — release blockers

1. `apps/admin/scripts/audit-responsive.mjs` contains a reusable default seller credential.
2. `/api/public/order` accepts a valid order for a suspended store although the storefront blocks the tenant.
3. Concurrent payment-request creation can create more than one payable provider bill for one order.
4. Incoming Inventory derives receipt quantities from a fixed percentage instead of persisted receipt facts.
5. The multi-variant quick inventory editor sends the same aggregate stock value to every variant.
6. The product editor's `Buat PO` dialog can close without creating a purchase order.
7. Navigation menu creation reports success without inserting the menu row.

#### P1 — high priority

1. Courier cancellation can succeed remotely and fail locally without a durable reconciliation state.
2. Product sales-channel and tag controls do not round-trip through the save contract.
3. Store-user invitation handling can misreport outcome across mail/DB failure and uniqueness races.
4. Checkout district search presents lookup failure as no results and can leave the field unusable.
5. The shared seller topbar produces 27 px horizontal overflow at 320 px on all 15 sampled routes.
6. The product editor warns about unsaved changes even when untouched and does not model save success/failure correctly.
7. No full lifecycle integration test covers order, payment callback, stock, ledger, replay, and tenant isolation together.
8. TokoΦ Account remains a standalone localStorage prototype with no recorded production-release decision.

#### P2 — hardening

1. Impersonation exchange drops the platform operator identity after the merchant token is minted.
2. `inventory_levels` has no direct tenant RLS policy, relying on parent-relation isolation.
3. Public rate limits are process-local and reset across replicas/restarts.
4. First-party cron/callback endpoints accept reusable secrets in query parameters.
5. SVG upload validation does not neutralize active SVG content.
6. `checkout.astro` (~2,759 lines) and `product-editor.tsx` (~1,364 lines) are oversized release-critical modules.

### Traceability and execution

- Accepted contracts and statuses: [`REQUIREMENTS.md`](./REQUIREMENTS.md).
- Exact target files, changes, and runnable acceptance checks: repository-root [`TASKS.md`](../../TASKS.md), Stages 4–7.
- Current queue and handoff entrypoint: [`tasks/OPEN.md`](./tasks/OPEN.md).
- Development order: three dependency-aware waves with independent lanes. Payment identity, inventory mutation, product editor, checkout, and migration-number contracts have a single owner per wave to prevent parallel implementations from defining competing behavior.

---


## Lampiran — gerbang yang hanya menyala kalau dijalankan

```bash
npm test                                  # vitest + astro check storefront + astro check landing
npm run test:db                           # sama, tapi DB test yang tidak terjangkau GAGAL, bukan skip
npm run verify -w @tokophi/storefront     # 6 cek browser: build kalau basi, start SATU server, tabel + exit code
npm run verify-rls -w @tokophi/db         # 11/11 — kalau merah, ada yang terjadi
npm run verify-migrations -w @tokophi/db  # jurnal vs file vs baris terpakai
npm run lint -w @tokophi/admin            # ⚠️ `next build` TIDAK menjalankan ESLint
```

**Tiga gerbang yang tidak dijalankan apa pun secara otomatis** (tidak ada CI di repo ini):
`npm run lint` (membusuk sampai 28 error pada 2026-07-31), `tsc --noEmit` (satu-satunya yang men-typecheck
file test), dan `npm run verify-rls`. Ketiganya hijau saat outage sungguhan pernah terjadi.

---

*Originally written 2026-08-03 from `origin/main` @ `b5f9ded`; refreshed 2026-08-16 with wave 8 evidence and the accepted pre-release queue.*
