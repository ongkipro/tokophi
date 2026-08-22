import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { codeOnly } from "../../../test/source-code";
import { APP_ROLE, IDENTITY_SQL, factsFromRow, judgeIdentity, planPools } from "./db-identity";

/**
 * Task 4.12 / SEC-18. Three claims, and they fail in three different ways, which is why they are
 * three suites:
 *
 *  ① The DECISION (pure). app-role mode has no owner fallback; a refusal names the variable, never
 *    the value. This is the half that shipped wrong for months as one `??`.
 *  ② The PROBE (real Postgres). `IDENTITY_SQL` is a string, so `tsc` has no opinion about it — a
 *    typo'd alias or a reserved word would fail only at runtime, in production, on the path that is
 *    supposed to be the safety net. It is therefore RUN, as a genuinely restricted login role and as
 *    the owner, and the verdicts compared.
 *  ③ The BOUNDARY. What a restricted connection actually sees with no `app.store_id` GUC — measured,
 *    not asserted in prose, because it is the reason the cross-tenant surfaces are still owner-mode.
 *
 * Every guard below was proved RED against a mutation of the source before it was trusted; the
 * mutations and their failure lines are recorded in `BUILD-LOG.md` under Task 4.12.
 */

const OWNER = "postgres://tokophi:hunter2@postgres:5432/tokophi";
const APP = "postgres://tokophi_app:s3cr3t@postgres:5432/tokophi";
const LOCAL = "postgresql://tokophi:tokophi@localhost:5433/tokophi";

describe("① planPools — app-role mode has no owner fallback", () => {
  it("REFUSES app-role mode with no APP_DATABASE_URL instead of using the owner URL", () => {
    const p = planPools({ NODE_ENV: "production", DATABASE_RUNTIME_ROLE: "app", DATABASE_URL: OWNER }, LOCAL);
    // The regression this whole task exists for: `APP_DATABASE_URL ?? ownerUrl` returned OWNER here,
    // so a service labelled restricted ran as a superuser with BYPASSRLS and nothing said so.
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("APP_DATABASE_URL");
  });

  it("app-role mode opens BOTH pools — the owner one is what auth, the public API and cron run on", () => {
    const p = planPools(
      { NODE_ENV: "production", DATABASE_RUNTIME_ROLE: "app", DATABASE_URL: OWNER, APP_DATABASE_URL: APP },
      LOCAL,
    );
    expect(p).toEqual({ ok: true, role: "app", ownerUrl: OWNER, appUrl: APP });
  });

  it("app-role mode still REQUIRES the owner URL — dropping it would delete the login page", () => {
    const p = planPools({ NODE_ENV: "production", DATABASE_RUNTIME_ROLE: "app", APP_DATABASE_URL: APP }, LOCAL);
    expect(p.ok).toBe(false);
  });

  it("owner mode is unchanged: one pool, and no identity to prove", () => {
    const p = planPools({ NODE_ENV: "production", DATABASE_RUNTIME_ROLE: "owner", DATABASE_URL: OWNER }, LOCAL);
    expect(p).toEqual({ ok: true, role: "owner", ownerUrl: OWNER, appUrl: null });
  });

  it("an unset DATABASE_RUNTIME_ROLE is owner — the label must be opted INTO, never inferred", () => {
    const p = planPools({ NODE_ENV: "production", DATABASE_URL: OWNER, APP_DATABASE_URL: APP }, LOCAL);
    expect(p).toEqual({ ok: true, role: "owner", ownerUrl: OWNER, appUrl: null });
  });

  it("owner mode with no DATABASE_URL refuses rather than reaching for the localhost dev default", () => {
    expect(planPools({ NODE_ENV: "production" }, LOCAL).ok).toBe(false);
  });

  it("dev/test keep the localhost fallback, one pool, no probe", () => {
    expect(planPools({}, LOCAL)).toEqual({ ok: true, role: "owner", ownerUrl: LOCAL, appUrl: null });
    // `DATABASE_RUNTIME_ROLE=app` outside a production runtime must not open a second pool either:
    // the Dockerfiles build with NODE_ENV unset/owner, and a local `app` label with no credential
    // would otherwise break every developer's `npm run dev`.
    expect(planPools({ DATABASE_RUNTIME_ROLE: "app", DATABASE_URL: OWNER }, LOCAL)).toEqual({
      ok: true,
      role: "owner",
      ownerUrl: OWNER,
      appUrl: null,
    });
  });
});

describe("② judgeIdentity — a superuser wearing a restricted label is refused", () => {
  const restricted = {
    currentUser: APP_ROLE,
    sessionUser: APP_ROLE,
    currentSuper: false,
    currentBypassRls: false,
    sessionSuper: false,
    sessionBypassRls: false,
    canAssumeAppRole: true,
  };

  it("accepts a genuinely restricted role and reports WHICH role it is", () => {
    expect(judgeIdentity(restricted)).toEqual({ ok: true, role: APP_ROLE });
  });

  it("refuses superuser and BYPASSRLS, on the session role AND on the effective role", () => {
    for (const key of ["currentSuper", "currentBypassRls", "sessionSuper", "sessionBypassRls"] as const) {
      const v = judgeIdentity({ ...restricted, [key]: true });
      expect(v.ok, key).toBe(false);
    }
  });

  it("a superuser that has SET ROLE to the restricted role is still refused", () => {
    // The shape `current_user` alone would call safe: effective role restricted, one RESET ROLE from
    // full privilege. This is why the probe reads both.
    const v = judgeIdentity({
      ...restricted,
      sessionUser: "tokophi",
      sessionSuper: true,
      sessionBypassRls: true,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("session_user");
  });

  it("refuses a restricted role that cannot assume tokophi_app — every withTenant txn would throw", () => {
    const v = judgeIdentity({ ...restricted, currentUser: "some_other_role", canAssumeAppRole: false });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain(APP_ROLE);
  });

  it("NO REFUSAL EVER CARRIES A CONNECTION STRING", () => {
    const reasons = [
      (planPools({ NODE_ENV: "production", DATABASE_RUNTIME_ROLE: "app", DATABASE_URL: OWNER }, LOCAL) as { reason: string })
        .reason,
      (planPools({ NODE_ENV: "production" }, LOCAL) as { reason: string }).reason,
      ...(["currentSuper", "currentBypassRls", "sessionSuper", "sessionBypassRls"] as const).map(
        (k) => (judgeIdentity({ ...restricted, [k]: true }) as { reason: string }).reason,
      ),
      (judgeIdentity({ ...restricted, canAssumeAppRole: false }) as { reason: string }).reason,
    ];
    for (const r of reasons) {
      // These strings are written to a container log and to an exception. A Postgres URL carries its
      // password inline, so "the reason mentions the URL" is a credential in a log file.
      expect(r).not.toContain("://");
      expect(r).not.toContain("hunter2");
      expect(r).not.toContain("s3cr3t");
      expect(r).not.toContain("5432");
    }
  });
});

describe("② client.ts logs the ROLE, never the URL", () => {
  // Read as CODE, not text: the comments in that file discuss the URL at length and a text match
  // would hit every one of them.
  const src = codeOnly(readFileSync(new URL("./client.ts", import.meta.url), "utf8"));
  // ⚠️ NOT `\burl\b`. That was the first version of this pattern and it was BLIND: the identifiers
  // in this file are `ownerUrl` / `appUrl`, and there is no word boundary in front of the `url` in
  // `appUrl`, so `console.log(plan.appUrl)` sailed straight past it (found by mutating the source —
  // the mutation matrix in BUILD-LOG.md records it as the one guard that came back green).
  const LOGS_A_URL = /console\s*\.\s*(?:log|error|warn|info)[^;]*url/i;

  it("no console call in client.ts is handed a url", () => {
    expect(LOGS_A_URL.test(src)).toBe(false);
  });

  it("…and the predicate is not vacuous — it fires on both shapes of the mistake", () => {
    // Mutation self-check. A source claim that matches nothing is green for the wrong reason; this
    // repo has shipped that mistake more than once (test/source-code.ts records nine of them).
    expect(LOGS_A_URL.test(codeOnly(`console.error("[@tokophi/db] cannot connect to " + plan.url);`))).toBe(true);
    expect(LOGS_A_URL.test(codeOnly("console.log(`[@tokophi/db] connected: ${plan.appUrl}`);"))).toBe(true);
  });

  const READS_A_URL_ENV = /process\s*\.\s*env\s*\.\s*(?:APP_)?DATABASE_URL/;

  it("client.ts reads NO database URL out of the environment itself — the decision has one home", () => {
    // The bug was a single `??` in this file. Keeping the choice in the pure module is what makes it
    // testable at all, so a second reader of the env here would quietly restore a second answer.
    expect(READS_A_URL_ENV.test(src)).toBe(false);
    expect(READS_A_URL_ENV.test(codeOnly(`const appUrl = process.env.APP_DATABASE_URL ?? ownerUrl;`))).toBe(true);
  });
});

describe("② withTenant runs on the restricted pool, behind the gate", () => {
  const rls = codeOnly(readFileSync(new URL("./rls.ts", import.meta.url), "utf8"));
  const AWAITS_GATE = /await\s+assertRestrictedDbIdentity\s*\(\s*\)/;
  const ON_APP_POOL = /return\s+appDb\s*\.\s*transaction/;
  const ON_OWNER_POOL = /[^\w]db\s*\.\s*transaction/;

  it("the tenant wrapper proves the identity before it opens a transaction", () => {
    // Nothing else checks this wiring: the gate can be perfectly correct and simply never called.
    expect(AWAITS_GATE.test(rls)).toBe(true);
    expect(rls.indexOf("assertRestrictedDbIdentity")).toBeLessThan(rls.indexOf("transaction"));
  });

  it("every merchant read and write lands on appDb, never on the owner handle", () => {
    // The whole gain of Task 4.12 is this one identifier. `db.transaction` here would put all 79
    // merchant files back on a superuser connection while every label kept saying otherwise — and
    // `SET LOCAL ROLE` two lines down would still make the suite look green.
    expect(ON_APP_POOL.test(rls)).toBe(true);
    expect(ON_OWNER_POOL.test(rls)).toBe(false);
  });

  it("…and neither predicate is vacuous", () => {
    const old = codeOnly(`export async function withTenant() { return db.transaction(fn); }`);
    expect(AWAITS_GATE.test(old)).toBe(false);
    expect(ON_APP_POOL.test(old)).toBe(false);
    expect(ON_OWNER_POOL.test(old)).toBe(true);
  });
});

// ── The Postgres half ────────────────────────────────────────────────────────────────────────────
// Runs `IDENTITY_SQL` for real, as a role that genuinely cannot log in as anything else.
//
// ⚠️ A Postgres role is CLUSTER-global, not per-database. The role below is created with a random
// name and a random password, is used only against the `*_test` database, and is dropped in
// `afterAll` (`drop owned by` first, or the drop fails on any privilege granted to it). It never
// touches the shared dev database's data. Recorded in the task handoff §⑥.
const TEST_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_URL ? describe : describe.skip;

let owner: postgres.Sql<Record<string, never>>;
let asProbe: postgres.Sql<Record<string, never>>;
const probeRole = `t412_probe_${randomBytes(4).toString("hex")}`;

beforeAll(async () => {
  if (!TEST_URL) return;
  owner = postgres(TEST_URL, { max: 2, onnotice: () => {} }) as unknown as postgres.Sql<Record<string, never>>;
  const password = randomBytes(24).toString("base64url");
  // `.unsafe` because a role name cannot be a bind parameter. Both halves are generated here, so
  // there is no user input anywhere near this string — and the password never leaves this process.
  await owner.unsafe(`create role "${probeRole}" login password '${password}'`);
  await owner.unsafe(`grant "${APP_ROLE}" to "${probeRole}"`);
  const u = new URL(TEST_URL);
  u.username = probeRole;
  u.password = password;
  asProbe = postgres(u.toString(), { max: 1, onnotice: () => {} }) as unknown as postgres.Sql<Record<string, never>>;
});

afterAll(async () => {
  await asProbe?.end();
  if (owner) {
    await owner.unsafe(`drop owned by "${probeRole}"`).catch(() => {});
    await owner.unsafe(`drop role if exists "${probeRole}"`).catch(() => {});
    await owner.end();
  }
});

suite("② the probe, run against real Postgres", () => {
  it("accepts a real restricted login role, and names it", async () => {
    const [row] = await asProbe.unsafe(IDENTITY_SQL);
    const facts = factsFromRow(row as Record<string, unknown>);
    expect(facts).toMatchObject({
      currentUser: probeRole,
      sessionUser: probeRole,
      currentSuper: false,
      currentBypassRls: false,
      canAssumeAppRole: true,
    });
    expect(judgeIdentity(facts)).toEqual({ ok: true, role: probeRole });
  });

  it("REFUSES the owner connection — the exact credential production runs on today", async () => {
    const [row] = await owner.unsafe(IDENTITY_SQL);
    const facts = factsFromRow(row as Record<string, unknown>);
    // The dev/CI container's role is the same shape as production's `tokophi`: superuser, BYPASSRLS.
    expect(facts.sessionSuper || facts.sessionBypassRls).toBe(true);
    const v = judgeIdentity(facts);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/SUPERUSER|BYPASSRLS/);
  });

  it("sees through a superuser that has SET ROLE to the restricted role", async () => {
    // Done on the OWNER connection: `session_user` stays the superuser while `current_user` becomes
    // tokophi_app. This is the one case a `current_user`-only probe would pass.
    await owner.begin(async (tx) => {
      await tx.unsafe(`set local role "${APP_ROLE}"`);
      const [row] = await tx.unsafe(IDENTITY_SQL);
      const facts = factsFromRow(row as Record<string, unknown>);
      expect(facts.currentUser).toBe(APP_ROLE);
      expect(facts.currentSuper).toBe(false);
      // ⚠️ Both halves, because they fail separately. The FLAGS come from the `s.rolname =
      // session_user` join predicate; the NAME comes from the `session_user::text` projection. A
      // mutation that changed only the projection kept this test green through the flags — so the
      // reported identity is pinned too, or a refusal could name the wrong role to the operator.
      expect(facts.sessionUser).not.toBe(APP_ROLE);
      expect(facts.sessionSuper || facts.sessionBypassRls).toBe(true);
      expect(judgeIdentity(facts).ok).toBe(false);
    });
  });
});

suite("③ the boundary — what a restricted connection sees with no tenant GUC", () => {
  it("zero rows on a policed table without the GUC, its own rows with it", async () => {
    // This is the measurement behind the decision NOT to point super-admin and the storefront at
    // tokophi_app (task handoff §③): all 50 policies are TO PUBLIC, so they apply to any role without
    // BYPASSRLS, and `app_current_store_id()` is NULL when nothing set the GUC. Everything here runs
    // inside a transaction that is always rolled back.
    class Rollback extends Error {}
    try {
      await owner.begin(async (tx) => {
        const [a] = await tx<{ id: string }[]>`insert into accounts (name) values ('T412 Probe') returning id`;
        const [s] = await tx<{ id: string }[]>`
          insert into stores (account_id, name, slug) values (${a.id}, 'T412 Probe Store', ${probeRole}) returning id`;

        await tx.unsafe(`set local role "${APP_ROLE}"`);
        const blind = await tx<{ n: number }[]>`select count(*)::int as n from stores where id = ${s.id}`;
        expect(blind[0].n).toBe(0); // ← a cross-tenant reader on this connection would render nothing

        await tx`select set_config('app.store_id', ${s.id}, true)`;
        const scoped = await tx<{ n: number }[]>`select count(*)::int as n from stores where id = ${s.id}`;
        expect(scoped[0].n).toBe(1); // ← and withTenant() works, because it sets the GUC

        await tx.unsafe("reset role");
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  });
});
