-- TokoΦ — give the seeded products a real parcel size (N33). **NOT EXECUTED. The owner's call.**
--
-- 🔴 STATUS: WRITTEN AND DRY-RUN ONLY. The last statement is `rollback` and it stays `rollback`.
--    Dry-run 2026-08-05 against a scratch copy of the dev database's `products` table:
--        rows matching (exactly 1×1×1)          24
--        rows updated                           24
--        rows left at 1×1×1 after the update     0
--        rows with any dimension NULL            0   (before and after)
--    Nothing was run against production. Counts there must be read before deciding — see below.
--
-- ── WHAT THE DEFECT IS ────────────────────────────────────────────────────────────────────────
-- `packages/db/src/seed.ts` and `seed-products.ts` wrote `length_cm = width_cm = height_cm = 1` for
-- every product they created. Those three columns are not decoration:
--   · KiriminAja bills the GREATER of the actual weight and the volumetric weight (`l × w × h ÷ 6`),
--     so 1×1×1 = 0,17 g never moves the quoted price — which is why nobody noticed;
--   · but `createShipment` (`apps/admin/lib/actions/shipping.ts`) sends the SAME columns when it
--     books, so the parcel is DECLARED TO THE COURIER as a one-centimetre cube. The courier
--     re-measures at pickup and bills the merchant the difference.
-- Wave 7 made the quote read these columns too, so with real numbers the shopper is quoted what the
-- parcel actually costs. With 1×1×1 that fix cannot fire at all (`NEXT.md` N30 says so in as many
-- words). The seed is fixed in `packages/db/src/product-dims.ts`; **the seed is not a migration**, so
-- nothing here reaches a row that already exists. Hence this file.
--
-- ── WHY IT IS NOT A DRIZZLE MIGRATION ─────────────────────────────────────────────────────────
-- Same reason as `tokophi-orphan-cleanup.sql`: a file in `packages/db/drizzle/` executes unattended
-- on merge. This UPDATE changes what a live storefront QUOTES a shopper — the ongkir on the demo
-- store goes UP, correctly, because a folded gamis is not a 1 cm cube. That is a visible change to a
-- running shop and it needs a human who has read the counts, not a green build.
--
-- ── WHY `1×1×1` AND NOT "ANY SEEDED PRODUCT" ──────────────────────────────────────────────────
-- ⚠️ `NEXT.md` N41 flags N33 as the counter-example that must not be swept into a bulk seed-drift
-- pass, and this WHERE clause is that warning made executable. It matches ONLY the exact
-- `1 AND 1 AND 1` fingerprint the seed left:
--   · a merchant who has opened Produk → Pengiriman and typed real numbers is NOT touched;
--   · a product with NULL dimensions is NOT touched — NULL means "unknown", the booking's `?? 10`
--     fallback already handles it, and inventing a size for a product we have never seen is the
--     defect this file repairs, not a fix;
--   · rows are matched by the garment word at the start of the HANDLE, which is how both seeders
--     name them (`dress-midi-bunga`, `blazer-formal-wanita-premium-slim-fit`). A handle whose first
--     segment is not in the list below is left alone and is reported by the last SELECT — read it.
-- The numbers are the ones in `packages/db/src/product-dims.ts`, and they are the FOLDED PARCEL
-- (a polymailer), not the garment. Keep the two files in step if either changes.
--
-- ── BEFORE YOU RUN IT ─────────────────────────────────────────────────────────────────────────
-- Read the counts on production first. Resolve the postgres container BY PREFIX — the hash suffix
-- changes on every deploy:
--   ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 \
--     'docker exec -i $(docker ps --format "{{.Names}}" | grep -m1 "^postgres-") psql -U tokophi -d tokophi' \
--     <<'SQL'
--   select s.slug,
--          count(*) filter (where p.length_cm = 1 and p.width_cm = 1 and p.height_cm = 1) as cube_1cm,
--          count(*) filter (where p.length_cm is null) as null_dims,
--          count(*) as total
--     from products p join stores s on s.id = p.store_id group by s.slug order by 3 desc;
--   SQL
-- If a store shows rows in neither column, it has real dimensions already and nothing here applies.

begin;

-- The garment kinds and their packed parcel, in centimetres. Mirrors PACKED_DIMS in
-- packages/db/src/product-dims.ts. `volumetric` (l*w*h/6, in grams) is the figure KiriminAja compares
-- against the actual weight; the seeded variants weigh 150–300 g each.
create temporary table n33_dims (kind text primary key, l int, w int, h int) on commit drop;
insert into n33_dims (kind, l, w, h) values
  ('hijab',    20, 15, 2),   --   100 g volumetric — nearly flat
  ('blouse',   28, 20, 4),   --   373 g
  ('kemeja',   30, 22, 5),   --   550 g
  ('tunik',    30, 22, 5),   --   550 g
  ('rok',      30, 22, 5),   --   550 g
  ('celana',   30, 22, 5),   --   550 g
  ('khimar',   28, 22, 5),   --   513 g
  ('piyama',   30, 24, 6),   --   720 g — two pieces
  ('dress',    32, 24, 6),   --   768 g
  ('jumpsuit', 33, 25, 7),   --   962 g
  ('cardigan', 32, 24, 8),   -- 1.024 g — knitwear does not compress
  ('blazer',   35, 26, 7),   -- 1.062 g — structured
  ('gamis',    35, 26, 7);   -- 1.062 g — the most fabric in the catalogue

-- ① The blast radius, BEFORE. Read this before the update, not after.
select d.kind, count(*) as rows_to_update
  from products p
  join n33_dims d on d.kind = split_part(p.handle, '-', 1)
 where p.length_cm = 1 and p.width_cm = 1 and p.height_cm = 1
 group by d.kind order by 2 desc, 1;

-- ② The update. Every predicate is on the row's OWN columns — no store id, no slug, no LIKE.
update products p
   set length_cm = d.l, width_cm = d.w, height_cm = d.h
  from n33_dims d
 where d.kind = split_part(p.handle, '-', 1)
   and p.length_cm = 1 and p.width_cm = 1 and p.height_cm = 1;
-- Expect the UPDATE count to equal the sum of ①. Anything else -> rollback and work out why.

-- ③ Verify inside the transaction: nothing is left at the fingerprint, and nothing became NULL.
select count(*) filter (where length_cm = 1 and width_cm = 1 and height_cm = 1) as still_1cm_cube,
       count(*) filter (where length_cm is null or width_cm is null or height_cm is null) as any_null,
       count(*) as products_total
  from products;

-- ④ What was NOT matched and why — a handle whose first segment has no entry above. These keep the
--    1 cm cube, which is the honest outcome (we do not know what they are), and they are the list to
--    act on next. An empty result is the expected one for a purely seeded catalogue.
select p.handle, s.slug
  from products p join stores s on s.id = p.store_id
 where p.length_cm = 1 and p.width_cm = 1 and p.height_cm = 1
 order by 2, 1;

rollback;   -- ⚠️ change to `commit` ONLY with the owner saying so, then change it straight back.
