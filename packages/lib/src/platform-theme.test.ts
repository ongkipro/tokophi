import { describe, expect, it } from "vitest";
import { PLATFORM_THEME_SLUG, PLATFORM_THEME_STORE_ID } from "./platform-theme";
import { RESERVED_SLUGS, slugify } from "./store-slug";

// The holder's identity is load-bearing in three places that never see each other: the deploy seed
// inserts it, Coolify's env names it, and the storefront queries `page_templates.store_id` with it.
// A malformed UUID here is a 22P02 THROW on every storefront page the moment the env is set — so the
// shape is pinned, not assumed.
describe("platform theme holder identity", () => {
  it("is a UUID Postgres will accept", () => {
    expect(PLATFORM_THEME_STORE_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("has a slug that is its own slugification — the seed writes it verbatim", () => {
    expect(slugify(PLATFORM_THEME_SLUG)).toBe(PLATFORM_THEME_SLUG);
  });

  it("is RESERVED, so no merchant can take the slug before the seed runs", () => {
    // Removing it from RESERVED_SLUGS reopens both halves: a merchant registering it makes the
    // deploy seed fail forever (unique slug), and the holder becomes resolvable as a subdomain.
    expect(RESERVED_SLUGS.has(PLATFORM_THEME_SLUG)).toBe(true);
  });
});
