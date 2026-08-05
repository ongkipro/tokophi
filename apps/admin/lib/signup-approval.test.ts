import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnly, textWithoutComments } from "../../../test/source-code";

// ── A SELF-SERVE STORE IS BORN LOCKED; AN OPERATOR-CREATED ONE IS NOT (0090) ─────────────────────
//
// Opening `SIGNUP_ENABLED` hands a live shop to whoever fills in the form, and nothing on the
// password path proves they control the address they typed — there is no mailer in this repo to
// build a verification with (`specs/docs/tasks/2026-08-05-signup-open-audit.md`). The cheapest thing
// that closes it is a human looking, so `provisionStore` creates the store suspended and leaves
// `approved_at` NULL, which is what puts it in the queue.
//
// The claim is a PAIR, and the second half is the one that would rot silently: super-admin's
// `createStore` must keep stamping `approvedAt`, because an operator typing a merchant in by hand has
// already vetted them. Lose that line and every hand-onboarded store lands in the review queue —
// live, writable, and labelled to its owner as "menunggu persetujuan". Nothing in TypeScript notices:
// the column is nullable, and both call sites still compile.
//
// Read as source, like `signup-metered.test.ts` beside it: both modules are `"use server"` and pull
// `@tokophi/db` at module scope, so importing them needs a live DATABASE_URL, and what is under test
// is structural. `codeOnly` throughout — a `suspendedAt` inside a comment locks nothing.
const SELF_SERVE = join(__dirname, "provision.ts");
const OPERATOR = join(__dirname, "..", "..", "super-admin", "lib", "actions.ts");
const BANNER = join(__dirname, "..", "app", "(admin)", "layout.tsx");
const read = (p: string) => codeOnly(readFileSync(p, "utf8"));
// ⚠️ CHOSEN PER ASSERTION, not per file. `codeOnly` makes every string literal's CONTENTS inert, so
// it is right for "this insert sets that column" and structurally blind to "this file says these
// words". The two copy claims below are about text the file EMITS to a merchant's screen, which is
// exactly what `textWithoutComments` is for — and using it means a sentence sitting in a comment
// would satisfy them, so both also assert something the comment alone cannot provide.
const copy = (p: string) => textWithoutComments(readFileSync(p, "utf8"));

// The `stores` insert of one file, isolated — otherwise a match could come from any of the six other
// inserts in the same transaction (accounts, users, store_users, locations, settings, stats).
function storesInsert(code: string): string {
  const at = code.indexOf("insert ( schema . stores )");
  expect(at, "no `insert(schema.stores)` found — has the provisioning shape changed?").toBeGreaterThan(-1);
  return code.slice(at, at + 900);
}

describe("self-serve signup lands in the review queue", () => {
  it("provisionStore creates the store SUSPENDED, with a reason", () => {
    const insert = storesInsert(read(SELF_SERVE));
    expect(insert).toMatch(/suspendedAt\s*:/);
    // The reason is shown to the merchant verbatim on their own dashboard, so it must be the named
    // constant rather than a string typed at the insert — one place to fix the words.
    expect(insert).toMatch(/suspendedReason\s*:\s*SIGNUP_PENDING_REASON/);
  });

  it("…and leaves approvedAt unset — that NULL is the queue", () => {
    // Setting it here would create the store already approved AND locked: invisible to the operator
    // queue, and permanently read-only with nobody told to look at it.
    expect(storesInsert(read(SELF_SERVE))).not.toMatch(/approvedAt\s*:/);
  });

  it("the merchant-facing reason says what is happening and how long", () => {
    expect(read(SELF_SERVE)).toMatch(/SIGNUP_PENDING_REASON\s*=/);
    // Not a match on the whole sentence — copy gets edited. It must name the wait, not a fault.
    expect(copy(SELF_SERVE)).toMatch(/Menunggu persetujuan/);
  });
});

describe("an operator-created store never enters the queue", () => {
  it("super-admin createStore stamps approvedAt", () => {
    expect(storesInsert(read(OPERATOR))).toMatch(/approvedAt\s*:\s*new Date\s*\(\s*\)/);
  });

  it("…and does NOT suspend it", () => {
    const insert = storesInsert(read(OPERATOR));
    expect(insert).not.toMatch(/suspendedAt\s*:/);
  });
});

describe("the merchant is told they are waiting, not that they were punished", () => {
  it("the admin banner branches on pendingApproval", () => {
    expect(read(BANNER)).toMatch(/pendingApproval/);
    // The punishing copy must stay reachable for a real suspension — a branch that swallowed it
    // would tell a merchant we locked for cause that they are simply waiting on us.
    expect(copy(BANNER)).toMatch(/Toko ditangguhkan oleh TokoΦ/);
  });
});

// ── THE COUNTER AND THE BANNER MUST AGREE ON WHO IS QUEUED ───────────────────────────────────────
//
// `computeBilling().pendingApproval` decides it in TypeScript, one store at a time. The Super Admin
// dashboard counts the whole table, so it asks Postgres the same question in SQL — two expressions
// of one rule, the shape this repo keeps getting bitten by. If they drift, the operator's queue and
// the merchant's banner disagree about who is waiting, and nothing errors.
//
// `textWithoutComments`, not `codeOnly`: the predicate lives INSIDE a `sql` template, and `codeOnly`
// makes a literal's contents inert — the same reason `inventory-location.test.ts` reaches for the
// other helper on its raw-SQL claims.
describe("the dashboard queue query asks the same question as pendingApproval", () => {
  const DATA = join(__dirname, "..", "..", "super-admin", "lib", "data.ts");

  it("requires `approved_at IS NULL` AND `suspended_at IS NOT NULL`, not one or the other", () => {
    const sqlText = textWithoutComments(readFileSync(DATA, "utf8"));
    const at = sqlText.indexOf("getPendingApprovals");
    expect(at, "getPendingApprovals is gone — has the queue moved?").toBeGreaterThan(-1);
    const body = sqlText.slice(at, at + 900);
    expect(body).toMatch(/approved_at\s+is\s+null/i);
    expect(body).toMatch(/suspended_at\s+is\s+not\s+null/i);
  });

  it("is NOT folded into the churn worklist", () => {
    // `getRiskQueue` answers "who is about to stop paying us" and deliberately excludes operator
    // suspensions. A queued signup filed there would sit at severity 100 forever and bury the churn
    // signals that list exists for — its reason union has no member for this, on purpose.
    expect(read(DATA)).not.toMatch(/kind\s*:\s*"pending_approval"/);
  });
});
