import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearFailedLogins, recordFailedLogin } from "./cache";
import { codeOnly } from "../../../test/source-code";

// A FAILED SIGN-IN WAS WRITTEN NOWHERE.
//
// Measured 2026-08-06: `grep -rn "failed_login|loginFailed|login_attempts"` over the whole repo
// returned nothing. A rate limit existed — `login:admin:<ip>` 15/min, `login:platform:<ip>` 10/min —
// but it counts an IP inside one process, so it can throttle an attack for weeks while no table, log
// or screen ever records that one named merchant is the target. `recordFailedLogin` is the witness
// that was missing.
//
// What is worth pinning here is not "it counts". It is the three judgements that decide whether the
// row is ever read, and the one rule that has no acceptable failure:
//
//   · it stays SILENT under the threshold — a row for an ordinary typo is a row nobody reads;
//   · it ESCALATES ×5 rather than firing every five — a flood is how a signal dies;
//   · 🔴 it never puts anything that could be the credential into the text.
//
// The last one is why the subject is checked for the SHAPE of an address before it is echoed. The
// likeliest route from a password to `platform_activity` is not a bug in the insert — it is a person
// typing it one field too high and pressing Enter.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

afterEach(() => vi.useRealTimers());

// Unique per case: the counter is module state, deliberately (it is the in-process Map the comment in
// `cache.ts` says it is), so two cases sharing an address would share a streak.
let n = 0;
const addr = () => `guard${n++}@toko.example`;

describe("failed-login bursts", () => {
  it("says nothing until the 5th consecutive failure", () => {
    const email = addr();
    // Two or three fumbled attempts is what a real person does with their own password. An audit row
    // there trains the operator to scroll past the feed, which is the failure mode this repo has
    // already paid for twice.
    for (let i = 1; i <= 4; i++) expect(recordFailedLogin("seller", email), `attempt ${i}`).toBeNull();
    expect(recordFailedLogin("seller", email)).toMatch(/^5 percobaan masuk gagal berturut-turut untuk /);
  });

  it("escalates 5 → 25 → 125 instead of one row per five failures", () => {
    const email = addr();
    const rows: string[] = [];
    for (let i = 0; i < 200; i++) {
      const text = recordFailedLogin("platform", email);
      if (text) rows.push(text);
    }
    // 200 attempts. One row per five would be 40; this is 3, and each states its own real count.
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("5 percobaan");
    expect(rows[1]).toContain("25 percobaan");
    expect(rows[2]).toContain("125 percobaan");
  });

  it("names the surface, so the control-plane row is distinguishable from a merchant one", () => {
    const seller = addr();
    const platform = addr();
    for (let i = 0; i < 4; i++) recordFailedLogin("seller", seller);
    for (let i = 0; i < 4; i++) recordFailedLogin("platform", platform);
    expect(recordFailedLogin("seller", seller)).toContain("di Dashboard Seller");
    expect(recordFailedLogin("platform", platform)).toContain("di Super Admin");
  });

  it("counts the ACCOUNT, not the request — and each door on its own", () => {
    // The whole reason this exists next to `rateLimit`: four failures from four different addresses
    // are four people fumbling, not a burst. And the same address failing on both doors is two
    // separate streaks — the control plane's is the one that reaches every tenant.
    const shared = addr();
    for (let i = 0; i < 4; i++) {
      expect(recordFailedLogin("seller", addr())).toBeNull();
      expect(recordFailedLogin("seller", shared)).toBeNull();
      expect(recordFailedLogin("platform", shared)).toBeNull();
    }
    expect(recordFailedLogin("seller", shared)).toContain("5 percobaan");
    expect(recordFailedLogin("platform", shared)).toContain("5 percobaan");
  });

  it("a success ends the streak — 'berturut-turut' has to mean it", () => {
    const email = addr();
    for (let i = 0; i < 4; i++) recordFailedLogin("seller", email);
    clearFailedLogins("seller", email);
    for (let i = 0; i < 4; i++) expect(recordFailedLogin("seller", email)).toBeNull();
  });

  it("normalises the address, so casing and spacing cannot split a streak", () => {
    const email = addr();
    recordFailedLogin("seller", email.toUpperCase());
    recordFailedLogin("seller", `  ${email}  `);
    recordFailedLogin("seller", email);
    recordFailedLogin("seller", email.toUpperCase());
    expect(recordFailedLogin("seller", ` ${email.toUpperCase()} `)).toContain("5 percobaan");
  });

  it("15 minutes of quiet ends the streak; 14 does not", () => {
    // Idle-based, not a fixed window: a one-per-minute grinder is exactly the shape a fixed boundary
    // forgets, and it is the same shape that already walks under the IP limiter.
    vi.useFakeTimers({ now: new Date("2026-08-06T09:00:00Z") });
    const slow = addr();
    for (let i = 0; i < 4; i++) {
      recordFailedLogin("seller", slow);
      vi.advanceTimersByTime(14 * 60_000);
    }
    expect(recordFailedLogin("seller", slow)).toContain("5 percobaan");

    const abandoned = addr();
    for (let i = 0; i < 4; i++) recordFailedLogin("seller", abandoned);
    vi.advanceTimersByTime(15 * 60_000 + 1);
    expect(recordFailedLogin("seller", abandoned)).toBeNull();
  });

  // 🔴 THE RULE WITH NO ACCEPTABLE FAILURE.
  it("never echoes a subject that is not a well-formed address", () => {
    // Every one of these is what the email box holds when somebody typed one field too high, or
    // pasted the wrong clipboard. None of them may reach an audit row.
    const notAddresses = ["tokophi123", "Rahasia!2026", "hunter2", "ongki batiknusantara", "", "   ", "admin@", "@toko.id"];
    for (const typed of notAddresses) {
      // `""` and `"   "` normalise to the same subject and therefore share one streak — correct, and
      // the reason each case starts from a clean count here rather than inheriting the previous one's.
      clearFailedLogins("seller", typed);
      let text: string | null = null;
      for (let i = 0; i < 5; i++) text = recordFailedLogin("seller", `${typed}`);
      expect(text, `subject ${JSON.stringify(typed)}`).toContain("alamat yang bukan email (tidak dicatat)");
      if (typed.trim()) expect(text).not.toContain(typed.trim().toLowerCase());
    }
  });

  it("echoes a real address, because that is the whole point of the row", () => {
    const email = addr();
    let text: string | null = null;
    for (let i = 0; i < 5; i++) text = recordFailedLogin("platform", email);
    expect(text).toContain(email);
  });
});

// ── Both doors, and the subject they hand over ────────────────────────────────────────────────────
//
// A unit test over `recordFailedLogin` cannot see whether either `signIn` calls it, nor WHAT it is
// handed. `recordFailedLogin("seller", password)` type-checks perfectly — both parameters are
// strings — so the second argument is a source claim or it is nothing. Read as CODE, never as text
// (`test/source-code.ts`): a commented-out call is not a call.
// ⚠️ AND IT MUST NAME THE BRANCH, NOT MERELY THE FILE. The first version of this guard asked only
// that `noteFailedLogin(` appear somewhere. Proved against a mutated copy, that was GREEN with the
// call on the bad-password branch commented out — the seller panel has a SECOND call site (a wrong
// 2FA code) and it satisfied the pattern on its own. The branch that matters most could have been
// deleted and nothing would have gone red. Each failure branch is pinned from its own condition.
const DOORS = [
  {
    file: "apps/admin/lib/actions/auth.ts",
    surface: "seller",
    what: "the merchant panel",
    branches: [
      { name: "wrong password", re: /verifyPassword[^{]*\{\s*await\s+noteFailedLogin\s*\(/ },
      // A wrong CODE is still a failed sign-in on this address, and the louder one — whoever is
      // typing has already cleared the password.
      { name: "wrong 2FA code", re: /verifyTotp[^{]*\{\s*await\s+noteFailedLogin\s*\(/ },
    ],
  },
  {
    file: "apps/super-admin/lib/actions/auth.ts",
    surface: "platform",
    what: "the control plane — it reaches every tenant",
    branches: [{ name: "wrong password", re: /verifyPassword[^{]*\{\s*await\s+noteFailedLogin\s*\(/ }],
  },
];

describe("both sign-in doors record their failures", () => {
  for (const door of DOORS) {
    const src = () => codeOnly(readFileSync(join(ROOT, door.file), "utf8"));

    it(`${door.file} counts failures for ${door.what}`, () => {
      // The subject must be the address the form supplied — nothing else, and above all not the
      // password sitting three lines above it in the same function.
      expect(src()).toMatch(new RegExp(`const\\s+text\\s*=\\s*recordFailedLogin\\s*\\(\\s*"${door.surface}"\\s*,\\s*email\\s*\\)`));
      // …and a sign-in that succeeds must end the streak, or every merchant eventually files a row.
      expect(src()).toMatch(new RegExp(`clearFailedLogins\\s*\\(\\s*"${door.surface}"\\s*,\\s*email\\s*\\)`));
      for (const b of door.branches) expect(src(), `${door.file} — ${b.name} branch`).toMatch(b.re);
    });

    it(`${door.file} writes only that text into platform_activity`, () => {
      // Shorthand `text` — the value is the const above, so the two assertions close the chain from
      // `recordFailedLogin(email)` to the row. A hand-built template here is how a credential would
      // get in, and it would fail this.
      expect(src()).toMatch(/platformActivity\s*\)\s*\.\s*values\s*\(\s*\{\s*kind\s*:\s*"admin"\s*,\s*text\s*[,}]/);
    });
  }

  it("proves those claims can go red — every pattern misses a mutated copy", () => {
    // A source guard that matches nothing is green forever, and this repo has shipped that mistake
    // more than once. So put each defect back on a COPY of the real file — never on the file another
    // stream may own — and assert the corresponding pattern stops matching.
    const admin = readFileSync(join(ROOT, DOORS[0].file), "utf8");
    const platform = readFileSync(join(ROOT, DOORS[1].file), "utf8");

    // ① the bad-password branch alone is removed. This is the mutation the first draft survived.
    const noPasswordBranch = codeOnly(admin.replace("await noteFailedLogin(email, row?.storeId ?? null);", ""));
    expect(noPasswordBranch).not.toMatch(DOORS[0].branches[0].re);
    expect(noPasswordBranch, "the 2FA branch is still there — which is exactly why it must not satisfy the guard alone").toMatch(DOORS[0].branches[1].re);

    // ② the 2FA branch alone is removed.
    expect(codeOnly(admin.replace("await noteFailedLogin(email, row.storeId);", ""))).not.toMatch(DOORS[0].branches[1].re);

    // ③ the recorder is handed the PASSWORD instead of the address.
    expect(codeOnly(platform.replace('recordFailedLogin("platform", email)', 'recordFailedLogin("platform", password)'))).not.toMatch(
      /const\s+text\s*=\s*recordFailedLogin\s*\(\s*"platform"\s*,\s*email\s*\)/,
    );

    // ④ the audit text is hand-built at the insert instead of coming from the recorder.
    expect(codeOnly(platform.replace("values({ kind: \"admin\", text })", "values({ kind: \"admin\", text: `gagal: ${email}` })"))).not.toMatch(
      /platformActivity\s*\)\s*\.\s*values\s*\(\s*\{\s*kind\s*:\s*"admin"\s*,\s*text\s*[,}]/,
    );
  });
});
