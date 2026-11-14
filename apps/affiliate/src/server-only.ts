// `server-only` is a Next.js bundling marker (fail the build if server code reaches a client bundle). The
// affiliate app's SSR bundle is server code by construction, and `@tokophi/lib/cache` — the Seller login's
// limiter and per-account failure streak, reused here rather than copied — opens with that import, which
// Rollup cannot resolve outside Next. astro.config.mjs aliases it to this empty module (the same move the
// root vitest.config.ts makes with test/stubs/server-only.ts).
export {};
