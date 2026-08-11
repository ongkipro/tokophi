/**
 * THE PLATFORM DEFAULT THEME HOLDER — one fixed identity, defined once (pure, no DB import, same
 * split as `platform-rank.ts` / `password.ts` / `store-slug.ts`).
 *
 * WHY A HOLDER EXISTS. T-9 first pointed `PLATFORM_DEFAULT_THEME_STORE_ID` at `batik-nusantara`'s
 * live rows, and `theme-source.ts` carried the warning in its own doc comment: that makes one
 * merchant's Store Builder a platform-wide control, acceptable ONLY while that store is ours. It is
 * about to become a real merchant's shop, so the default now lives in a store the platform owns:
 * `packages/db/src/seed-platform-theme.ts` creates this row (idempotent, in the deploy's migrate
 * chain) and copies the batik templates into it once. Editing the platform default is then editing
 * a store no merchant holds — never a live shop.
 *
 * THE ID IS A CONSTANT, NOT A LOOKUP. The storefront resolves the holder from the env var
 * `PLATFORM_DEFAULT_THEME_STORE_ID` at render time (the off-switch stays an env var, deliberately —
 * unset means every store renders only its own rows). A fixed UUID is what lets the seed be
 * idempotent across deploys and lets the deploy note say exactly what to paste into Coolify.
 */
export const PLATFORM_THEME_STORE_ID = "a0000000-0000-4000-8000-000000000001";

/**
 * The holder's slug. Reserved in `RESERVED_SLUGS` (`store-slug.ts`) so (a) no merchant can register
 * it before the seed runs — `stores.slug` is unique, and a merchant holding it would make the seed's
 * insert fail forever — and (b) the storefront never resolves it as a merchant subdomain. The row is
 * ALSO created suspended (`store-servable.ts` gates on `suspendedAt`), so the reservation is the
 * belt and the suspension is the braces: neither alone should be the only thing keeping platform
 * content off a public hostname.
 */
export const PLATFORM_THEME_SLUG = "tema-platform";
