import { describe, expect, it } from "vitest";
import { can, ROLE_CAPS, type Role } from "./rbac-policy";

// `landing:html` guards RAW MARKUP that `lp/[slug].astro` renders with `set:html` — emitted into the
// SSR response body and parsed by the browser, so a `<script>` in it RUNS, on the shop's own origin,
// on the page carrying the COD order form (name, WhatsApp, full address). No sanitizer, no CSP.
//
// It used to need only `content:write`, which `staff` holds in EVERY tenant. The 2026-07-30 decision
// was to narrow it to the owner rather than ship a regex sanitizer that would only look like one.
//
// This test exists because that narrowing is one careless `ALL_CAPABILITIES` edit from being undone,
// and the undo would be silent: nothing else in the app would fail.

const ROLES: Role[] = ["owner", "admin", "staff", "gudang"];

describe("landing:html is owner-only", () => {
  it("no role except owner holds it", () => {
    const holders = ROLES.filter((r) => can(r, "landing:html"));
    expect(holders).toEqual(["owner"]);
  });

  it("admin is derived by SUBTRACTION, so a new capability must be excluded deliberately", () => {
    // `admin` is `ALL_CAPABILITIES.filter(...)`, i.e. it opts OUT. A capability added to the union
    // without touching that filter lands in `admin` by default — which is how this one would leak.
    expect(can("admin", "landing:html")).toBe(false);
    expect(can("admin", "settings:write")).toBe(false);
    expect(can("admin", "integrations:write")).toBe(false);
  });

  it("the ESCALATION is on the markup, not on the feature", () => {
    // Staff keep managing a landing's title, slug, product, countdown and funnel fields — those carry
    // none of the power the HTML does. Taking `content:write` away would be a bigger change than the
    // decision asked for.
    for (const r of ["admin", "staff"] as Role[]) {
      expect(can(r, "content:write"), `${r} should still manage landings`).toBe(true);
      expect(can(r, "landing:html"), `${r} must not edit raw HTML`).toBe(false);
    }
  });

  it("is registered in the union, or the UI gate would silently pass", () => {
    // `useCan` reads the same matrix; a capability missing from `ALL_CAPABILITIES` still type-checks
    // and would simply be absent from every role — including owner, locking everyone out instead.
    expect(ROLE_CAPS.owner).toContain("landing:html");
  });
});
