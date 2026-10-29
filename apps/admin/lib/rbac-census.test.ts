import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES, ROLE_CAPS, can, type Capability, type Role } from "./rbac-policy";

// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
//
// `admin` is derived by SUBTRACTION — `ALL_CAPABILITIES.filter(c => c !== …)` — so **a new
// capability lands in `admin` by default** unless whoever adds it remembers to exclude it. `staff`
// and `gudang` are allow-lists and are immune by construction. That default has already mattered
// once: `landing:html` is owner-only precisely because the raw markup behind it EXECUTES on the
// shop's own origin, on the page carrying the COD order form.
//
// `rbac-landing.test.ts` pins that ONE capability. Nothing pinned the CLASS, and the leak is silent
// in the worst way: nothing fails, the extra grant just exists.
//
// ── WHY A CENSUS AND NOT AN ALLOW-LIST ─────────────────────────────────────────────────────────
//
// Converting `admin` to an explicit allow-list is the obvious fix and it trades one silent failure
// for another: a capability you forget to list is silently REMOVED from `admin`. That direction is
// worse to diagnose, because `useCan` hides the control — the admin does not get an error, the
// button simply is not there, and nobody can say why. So the grant stays exactly as it is and the
// DECISION is what gets pinned.
//
// `CENSUS` is a `Record<Capability, Holder>`, so TypeScript requires an entry for every capability.
// Adding one to the union without classifying it fails `tsc -p apps/admin/tsconfig.json` at the
// point of edit, and fails this suite at runtime (the key is absent from the object literal). It
// cannot leak, and it cannot silently vanish either — both directions are loud.
//
// ⚠️ Editing an entry here is how you record a deliberate change of mind. It is not a formality:
// moving a capability to `"admin-too"` grants it to every store's Admin user in production.

/** Who is MEANT to hold a capability. `owner-only` = the owner and nobody else. */
type Holder = "owner-only" | "admin-too";

const CENSUS: Record<Capability, Holder> = {
  "products:write": "admin-too",
  "products:delete": "admin-too",
  "discounts:write": "admin-too",
  // Affiliate programme (0116) — approve/rate/mark-paid; the money moves outside TokoΦ.
  "affiliates:write": "admin-too",
  "content:write": "admin-too",
  "orders:write": "admin-too",
  "inventory:write": "admin-too",
  "purchases:write": "admin-too",
  "customers:write": "admin-too",
  "crm:write": "admin-too",
  "media:write": "admin-too",
  "support:write": "admin-too",
  "chat:read": "admin-too",
  "chat:write": "admin-too",
  "theme:write": "admin-too",
  // Store-level settings: the bank account the payouts land in.
  "settings:write": "owner-only",
  // Tracking / Meta connection — stores tenant secrets and is a store-level setting.
  "integrations:write": "owner-only",
  // Raw markup rendered with `set:html` on the shop's own origin, on the page carrying the COD order
  // form (name, WhatsApp, full address). No sanitizer, no CSP. 2026-07-30 decision.
  "landing:html": "owner-only",
};

const ROLES: Role[] = ["owner", "admin", "staff", "gudang"];
const CENSUS_KEYS = Object.keys(CENSUS) as Capability[];

describe("the admin capability census", () => {
  it("classifies every capability — a new one cannot arrive unclassified", () => {
    // The runtime half of the mapped-type guard: if `Capability` grew and this literal did not, the
    // key is missing here even though `ALL_CAPABILITIES` already carries it.
    expect([...CENSUS_KEYS].sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  it("admin holds exactly the capabilities the census says it does", () => {
    const declared = CENSUS_KEYS.filter((c) => CENSUS[c] === "admin-too").sort();
    const actual = ALL_CAPABILITIES.filter((c) => can("admin", c)).sort();
    expect(actual).toEqual(declared);
  });

  it("an owner-only capability reaches the owner and nobody else", () => {
    for (const cap of CENSUS_KEYS.filter((c) => CENSUS[c] === "owner-only")) {
      const holders = ROLES.filter((r) => can(r, cap));
      expect(holders, `${cap} must be owner-only`).toEqual(["owner"]);
    }
  });

  it("owner holds every capability, so a missing union entry locks everyone out instead", () => {
    // A capability that exists in the `Capability` type but never reaches `ALL_CAPABILITIES` is held
    // by NO role — the server guard then throws for the owner too, and the UI hides the control.
    for (const cap of CENSUS_KEYS) expect(can("owner", cap), `owner must hold ${cap}`).toBe(true);
    expect(new Set(ROLE_CAPS.owner).size).toBe(ALL_CAPABILITIES.length);
  });
});
