-- TokoΦ — storefront monochrome reset (2026-11-05, branch feat/storefront-redesign, SF-REDESIGN-C).
--
-- WHAT: the storefront redesign makes the platform default black / white / grey (DEFAULT_BRAND_COLOR
-- #18181b + NEUTRAL_BRAND_SHADES). A store with NO brand colour picks that up from the code alone. The
-- owner ruled (2026-11-05, "Reset semua ke monokrom") that stores which DID pick a colour or a Tema
-- token set are reset too, so every active store launches on the new look; merchants can re-pick in
-- Tema afterwards. The code change does not touch these rows — THIS file does. Nothing else applies it.
--
-- WHO IT TOUCHES: active stores (`suspended_at IS NULL`) holding a non-null `brand_color` or `theme`,
-- never the platform theme holder (`tema-platform`). Local prod copy (late Oct): petanihandal #1B5E20,
-- atthario-shop #80ff00, and on production batiknusantara #910311 + {font elegan, tone hangat, 4:5}.
--
-- REVERSIBLE: every value is copied to `ops_backup.store_theme_20261105` first. The backup lives in
-- its own schema on purpose: `verify-rls` audits `public` only, and a store-keyed table there would
-- (correctly) fail it. Restore + cleanup statements are at the foot of this file.
--
-- SAFE TO RE-RUN: the backup insert is `on conflict do nothing` (the FIRST snapshot wins — a re-run
-- after the reset must not overwrite it with NULLs), and the update matches only rows still set.
--
-- RUN ONLY WITH OWNER APPROVAL, AFTER the redesign is deployed (before it, a store reset to NULL would
-- render the OLD rose default). Production: AGENTS.md "ssh … docker exec … psql" (resolve postgres- by
-- prefix). Dry-run first: replace the final `commit;` with `rollback;`.

begin;

create schema if not exists ops_backup;

create table if not exists ops_backup.store_theme_20261105 (
  store_id    uuid primary key,
  slug        text not null,
  brand_color text,
  theme       jsonb,
  backed_up_at timestamptz not null default now()
);

-- SCOPE (review 2026-11-05): the ruling is MONOCHROME — colour only. `theme` also holds the store's
-- `font` and its image ratios (`galleryAspect`, `cardAspect`, e.g. batiknusantara's 4:5 PDP gallery);
-- those are layout, not colour, and are KEPT. Only `brand_color` and `theme.tone` are cleared.
-- RE-RUN SAFE (review 2026-11-05): a store already in the backup was reset by an earlier run; after
-- that, any colour it has is the MERCHANT's new pick — a second run must not wipe it (the backup's
-- first-snapshot-wins rule would lose it for good). So stores already backed up are skipped.
create temp table already_reset on commit drop as
  select store_id from ops_backup.store_theme_20261105;

insert into ops_backup.store_theme_20261105 (store_id, slug, brand_color, theme)
select id, slug, brand_color, theme
  from stores
 where suspended_at is null
   and slug <> 'tema-platform'
   and (brand_color is not null or theme ? 'tone')
on conflict (store_id) do nothing;

update stores
   set brand_color = null,
       theme = nullif(theme - 'tone', '{}'::jsonb)
 where suspended_at is null
   and slug <> 'tema-platform'
   and (brand_color is not null or theme ? 'tone')
   and id not in (select store_id from already_reset)
returning slug, theme;

select slug, brand_color, theme from ops_backup.store_theme_20261105 order by slug;

commit;

-- ── RESTORE (one store, or drop the WHERE for all) ────────────────────────────────────────────────
-- (restores the full snapshot, incl. any font/aspect the merchant changed SINCE — check `theme` first)
-- update stores s set brand_color = b.brand_color, theme = b.theme
--   from ops_backup.store_theme_20261105 b where b.store_id = s.id and b.slug = 'petanihandal';
--
-- ── CLEANUP (once the owner is satisfied; the backup is the only copy of the old values) ──────────
-- drop table ops_backup.store_theme_20261105; drop schema if exists ops_backup;
