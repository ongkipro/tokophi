-- TokoΦ — catalog category repair (2026-10-12, branch fix/merchant-category-google-catalog).
--
-- WHAT: the product editor defaulted the merchant category to "Fashion" (a value its own 7-item fashion
-- dropdown did not even offer) and the Google-category suggester matched substrings. Result on every
-- non-batik tenant: breadcrumb/PDP "Kategori"/feed product_type = "Fashion" (a fertiliser shop
-- included), a 404 /kategori/fashion link, "Serum Tanaman" classified as Skin Care, plant products
-- with no Google category, and gender "women" (not a Google enum) on Permata bags.
-- The code fix stops new bad rows; THIS file repairs the existing ones. Nothing else applies it.
--
-- SAFE TO RE-RUN: every statement matches only rows still holding the known-bad value, so a
-- merchant's later manual edit is never overwritten.
-- Dry-run 2026-10-12 on a clone of the local prod copy (synced 2026-10-11):
--   47 category "Fashion" → NULL · 6 Google category set/fixed · 14 Difa containers → Travel Bottles
--   · 6 Valoish → Feminine Sanitary
--   · 3 path-without-id restored · 23 gender women → female · 1 fertiliser gender/age cleared.
-- Run against production: see AGENTS.md "ssh … docker exec … psql" (resolve postgres- by prefix).

begin;

-- 1. "Fashion" was the editor's unchosen default (never in its own dropdown). Blank = storefront falls
--    back to the product's real collection (breadcrumb, card label, feed product_type).
update products set category = null, updated_at = now() where category = 'Fashion';

-- 2. Google category: the fixed suggester's verdicts, only for rows that are empty or provably wrong.
update products p set google_category_id = v.id, google_category_path = t.path, updated_at = now()
from (values
  ('petanihandal', 'Saratoga - Serum Tanaman Premium untuk Fase Penting', 113, 567),
  ('petanihandal', 'Kojien - Stabilitas Pertumbuhan Tanaman Pangan',      113, null),
  ('petanihandal', 'Bensu - Stimulator Pemulihan Tanaman Hortikultura',   113, null),
  ('petanihandal', 'Aussie Sawit Ganoderma - Recovery Sawit & Anti-Kulat', 691, null),
  ('zanobyshop',   'Pupuk pelebat',                                       113, null),
  ('batiknusantara','Kefir Collagen Soap 60gr Kefir Collagen Soap 60gr',  474, 525)
) as v(slug, title, id, was)
join product_taxonomy t on t.id = v.id
join stores s on s.slug = v.slug
where p.store_id = s.id and p.title = v.title and p.google_category_id is not distinct from v.was::int;

update products p set google_category_id = 485, google_category_path = t.path, updated_at = now()
from stores s, product_taxonomy t
where s.slug = 'valoish-store' and p.store_id = s.id and t.id = 485 and p.google_category_id is null;

-- 2b. Difa pack sells EMPTY containers ("Pot Lulur", "Botol Putri … Untuk Toner"), not the cosmetics.
update products p set google_category_id = 6919, google_category_path = t.path, updated_at = now()
from stores s, product_taxonomy t
where s.slug = 'difa-pack' and p.store_id = s.id and t.id = 6919
  and p.title ~* '(^(botol|pot) )|pot krim' and (p.google_category_id is null or p.google_category_id in (567, 474));

-- 3. Path stored without its id (Permata bags): restore the id from the path.
update products p set google_category_id = t.id, updated_at = now()
from product_taxonomy t where p.google_category_id is null and p.google_category_path = t.path;

-- 4. Feed enums: "women" is not a Google value; a fertiliser has no gender/age.
update products set gender = 'female', updated_at = now() where gender = 'women';
update products p set gender = null, age_group = null, updated_at = now()
from stores s where s.slug = 'zanobyshop' and p.store_id = s.id and p.title = 'Pupuk pelebat';

commit;
