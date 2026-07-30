// Stub for Next's `server-only` marker, used by vitest only (see vitest.config.ts).
// In a Next build that package throws when a module reaches a client bundle; in a Node test runner
// there is no client bundle, so the marker has nothing to assert and an empty module is the truth.
export {};
