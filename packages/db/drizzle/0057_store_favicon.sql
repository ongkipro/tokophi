-- ─────────────────────────────────────────────────────────────────────────────
-- 0057 — `stores.favicon_url`: the tab icon of the merchant's own shop.
--
-- Companion to `logo_url`, which has been a HALF-BUILT feature: the storefront has always READ it
-- (Header.astro renders the merchant's logo, Layout.astro feeds it to the OG image, checkout.astro
-- pulls it for branding) and NOTHING has ever written it — no admin form, no super-admin action, not
-- even the seed. A consumer with no producer: every shop was guaranteed to fall back to a wordmark,
-- forever, and no screen told the merchant a logo was even possible.
--
-- The favicon had not even got that far: no column at all, so every merchant's storefront served the
-- platform's own icon. A shop on its own domain showing someone else's favicon reads as "this is not
-- really my site" — the exact impression a white-label store builder is sold to avoid.
--
-- Nullable on purpose: NULL = "not set", and the storefront falls back rather than rendering a broken
-- image. Clearing it is a legitimate action, not an error — same rule as `whatsapp`/`tagline` (0049).
-- ─────────────────────────────────────────────────────────────────────────────

alter table stores add column if not exists favicon_url text;
