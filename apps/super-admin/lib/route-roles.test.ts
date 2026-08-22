import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";
import { canOpenPath, landingForRole, minRoleForPath, ROUTE_RULES } from "./route-roles";
import type { PlatformRole } from "./platform-rank";

/**
 * PLATFORM ROLES AT ROUTE ENTRY (Task 5.17 / SEC-9).
 *
 * Two claims, and they fail in different ways, so they are tested separately:
 *
 *   1. THE POLICY — who may open what. Pure, so it is asserted against an explicit table rather
 *      than re-derived from the same map it is checking (a table that mirrors the implementation
 *      proves only that the implementation equals itself).
 *   2. THE WIRING — every protected page actually calls the gate, with ITS OWN route, ABOVE its
 *      first privileged read. That is a claim about page source, and it is read as CODE
 *      (`test/source-code.ts`): the whole defect being closed is data that was fetched before
 *      anything checked a rank, and a comment saying otherwise must never keep this green.
 *
 * The page list is derived from the DIRECTORY, never hand-maintained — the repo has paid twice for
 * a guard bound to a list of targets (the `public` skip; `check-search-srcset` missing from the
 * runner). A new `page.tsx` under `(platform)` fails this suite until it is gated and classified.
 *
 * Every claim below was proved RED against a mutation; the results are in BUILD-LOG.md.
 */

const ROLES: PlatformRole[] = ["support", "admin", "owner"];

// The policy, written out. `true` = this rank may LOAD the screen.
const EXPECTED: Record<string, Record<PlatformRole, boolean>> = {
  "/": { support: false, admin: true, owner: true },
  "/tiket": { support: true, admin: true, owner: true },
  "/tiket/9f0b7e7c-0000-4000-8000-000000000001": { support: true, admin: true, owner: true },
  "/toko": { support: true, admin: true, owner: true },
  "/toko/9f0b7e7c-0000-4000-8000-000000000002": { support: true, admin: true, owner: true },
  "/update-log": { support: true, admin: true, owner: true },
  "/paket": { support: false, admin: true, owner: true },
  "/pencairan": { support: false, admin: true, owner: true },
  "/analitik": { support: false, admin: true, owner: true },
  "/pengaturan": { support: false, admin: true, owner: true },
};

describe("route floors — the policy", () => {
  it("answers every route class for every rank", () => {
    const actual: Record<string, Record<string, boolean>> = {};
    for (const path of Object.keys(EXPECTED)) {
      actual[path] = Object.fromEntries(ROLES.map((r) => [r, canOpenPath(r, path)]));
    }
    expect(actual).toEqual(EXPECTED);
  });

  it("gives money and platform configuration a floor above support — THE DEFECT", () => {
    // `/pencairan` served a support operator every merchant's bank account and pending amount, in
    // full, because nothing but the buttons had ever compared a rank.
    for (const path of ["/", "/pencairan", "/paket", "/analitik", "/pengaturan"]) {
      expect(canOpenPath("support", path), `${path} must not open for support`).toBe(false);
      expect(minRoleForPath(path)).toBe("admin");
    }
  });

  it("keeps the floor at the LOWEST rank that can use the screen", () => {
    // `/pengaturan` hosts admin-rank actions (couriers, channels, connection tests) beside
    // owner-rank ones (inviting an operator). A floor of `owner` would lock out the operator the
    // admin-rank actions were written for; those keep refusing at their own gate.
    expect(minRoleForPath("/pengaturan")).toBe("admin");
    expect(canOpenPath("admin", "/pengaturan")).toBe(true);
  });

  it("matches the LONGEST prefix, and only on a segment boundary", () => {
    expect(minRoleForPath("/toko/abc/apa-saja")).toBe("support");
    // Not a prefix match on characters: a different route that merely starts with the same letters
    // must not inherit the floor.
    expect(minRoleForPath("/tokohijau")).toBe("owner");
    expect(minRoleForPath("/pencairan-lama")).toBe("owner");
  });

  it("normalises the shapes a URL really arrives in", () => {
    expect(minRoleForPath("/pencairan/")).toBe("admin");
    expect(minRoleForPath("/pencairan?tab=menunggu")).toBe("admin");
    expect(minRoleForPath("")).toBe("admin"); // "" is the dashboard
  });

  it("fails CLOSED on a route nobody classified", () => {
    // Same shape as `platform-rank.ts`: unknown scores nothing. A new screen starts out reachable
    // by the owner alone rather than by everybody — and the directory sweep below then fails.
    expect(minRoleForPath("/laporan-baru")).toBe("owner");
    expect(canOpenPath("admin", "/laporan-baru")).toBe(false);
  });

  it("refuses a role that is not on the ladder", () => {
    for (const role of [undefined, "", "superadmin", "SUPPORT"]) {
      expect(canOpenPath(role, "/tiket"), `${String(role)} must clear nothing`).toBe(false);
    }
  });

  it("sends a refused operator somewhere they can actually go", () => {
    // The support desk is where a support operator belongs — and where the dashboard forwards them
    // on login, because middleware cannot know a rank and sends every session to `/`.
    expect(landingForRole("support")).toBe("/tiket");
    for (const role of ROLES) {
      const landing = landingForRole(role);
      expect(canOpenPath(role, landing), `${role} is sent to a page that refuses them`).toBe(true);
    }
  });

  it("gives every rule a reason a human can argue with", () => {
    for (const rule of ROUTE_RULES) expect(rule.why.length, rule.prefix).toBeGreaterThan(20);
  });
});

/* ── THE WIRING ─────────────────────────────────────────────────────────────────────────────── */

const PAGES_ROOT = new URL("../app/(platform)", import.meta.url).pathname;

/** Every `page.tsx` under the route group, as [route path, absolute file]. Derived, never listed. */
function pageRoutes(): { route: string; file: string }[] {
  const out: { route: string; file: string }[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // `(group)` folders do not appear in the URL; `[id]` is a parameter.
        const seg = entry.startsWith("(") ? null : entry;
        walk(full, seg ? [...segments, seg] : segments);
      } else if (entry === "page.tsx") {
        out.push({ route: `/${segments.join("/")}`.replace(/\/+$/, "") || "/", file: full });
      }
    }
  };
  walk(PAGES_ROOT, []);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

/** The rule prefix a page's route falls under — the literal the page must pass to the gate. */
const prefixFor = (route: string): string | null => {
  const concrete = route.replace(/\[[^\]]+\]/g, "x");
  const hit = ROUTE_RULES.filter((r) => (r.prefix === "/" ? concrete === "/" : concrete === r.prefix || concrete.startsWith(`${r.prefix}/`)))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return hit?.prefix ?? null;
};

/** Identifiers imported from a module that reads the database. */
function dataIdentifiers(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    const from = m[2];
    if (!/^(@\/lib\/(data|health)|\.\/cron-liveness)$/.test(from)) continue;
    for (const raw of m[1].split(",")) {
      const name = raw.replace(/\btype\b/, "").split(/\s+as\s+/)[0].trim();
      if (name && !/^type$/.test(name)) names.push(name);
    }
  }
  return names;
}

const pages = pageRoutes();

describe("every protected page enforces its floor before it reads anything", () => {
  it("finds the pages at all", () => {
    // If this walk ever returns nothing, every claim below passes vacuously.
    expect(pages.length).toBeGreaterThanOrEqual(10);
    expect(pages.map((p) => p.route)).toContain("/pencairan");
  });

  it.each(pages)("$route is classified", ({ route }) => {
    expect(prefixFor(route), `no ROUTE_RULES entry covers ${route} — classify it, don't leave it to the owner default`).not.toBeNull();
  });

  it.each(pages)("$route gates with its own route, above its first data read", ({ route, file }) => {
    const raw = readFileSync(file, "utf8");
    const src = codeOnly(raw);
    const prefix = prefixFor(route);
    const call = codeOnly(`platformRouteGate("${prefix}")`);

    const body = src.slice(src.indexOf("export default"));
    expect(body.indexOf(call), `${route} must call platformRouteGate("${prefix}")`).toBeGreaterThan(-1);
    // Refused ⇒ the page must END here. Two accepted shapes: the denial screen, or — on the
    // dashboard alone, where every login lands — a forward to the rank's own home.
    const stops = body.includes(codeOnly("return <RouteDenied")) || body.includes(codeOnly("redirect(gate.landing)"));
    expect(stops, `${route} calls the gate and then carries on regardless`).toBe(true);

    // …and nothing privileged is read before it. `codeOnly` joins tokens with single spaces, so a
    // call reads `getPayouts ( )`.
    const gateAt = body.indexOf(call);
    for (const name of dataIdentifiers(raw)) {
      const at = body.indexOf(`${name} (`);
      if (at === -1) continue;
      expect(at, `${route}: ${name}() is read before the rank is checked`).toBeGreaterThan(gateAt);
    }
  });

  it("the predicates fire against a page with the gate removed", () => {
    // Mutation self-check. Without this, a pattern that matches nothing is indistinguishable from a
    // pattern that matches everything — the way this repo's guards have gone green nine times.
    const real = readFileSync(pages.find((p) => p.route === "/pencairan")!.file, "utf8");
    const stripped = codeOnly(
      real
        .replace(/const gate = await platformRouteGate\("[^"]*"\);/, "")
        .replace(/if \(!gate\.ok\) return <RouteDenied[^\n]*\n/, ""),
    );
    const body = stripped.slice(stripped.indexOf("export default"));
    expect(body.includes(codeOnly('platformRouteGate("/pencairan")'))).toBe(false);
    expect(
      body.includes(codeOnly("return <RouteDenied")) || body.includes(codeOnly("redirect(gate.landing)")),
    ).toBe(false);

    // …and the ordering claim fires when the gate is merely moved BELOW the read, which is the
    // subtler regression: present, called, and useless.
    const reordered = codeOnly(`
      export default async function PencairanPage() {
        const [payouts] = await Promise.all([getPayouts()]);
        const gate = await platformRouteGate("/pencairan");
        if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;
      }
    `);
    const tail = reordered.slice(reordered.indexOf("export default"));
    expect(tail.indexOf("getPayouts (")).toBeLessThan(tail.indexOf(codeOnly('platformRouteGate("/pencairan")')));
  });
});

describe("the sidebar offers only what the rank can open", () => {
  const NAV_SRC = codeOnly(readFileSync(new URL("./nav.ts", import.meta.url), "utf8"));
  const SHELL_SRC = codeOnly(
    readFileSync(new URL("../app/(platform)/platform-shell.tsx", import.meta.url), "utf8"),
  );

  it("derives the filter from the same rules the gate uses", () => {
    // A sidebar computed from its own private list is how a screen ends up hidden but reachable —
    // or offered but denied. One source, both halves.
    expect(NAV_SRC).toContain(codeOnly("canOpenPath("));
    expect(SHELL_SRC).toContain(codeOnly("navFor(admin.role)"));
    expect(SHELL_SRC, "the sidebar must render the filtered list").toContain(codeOnly("{nav.map("));
  });
});
