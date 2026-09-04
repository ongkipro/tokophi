import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// Three audit-log gaps from the 2026-09-04 page-map sweep (SA-1, SA-2, SA-4), closed together with
// the screen that reads the log (`/log-sistem`). A log line is only evidence if it is written for
// something that HAPPENED — "report what you WROTE" is the standing rule (`markLabelsPrinted`,
// `setStoreUserRole`, `suspendStore`), and each of these three had a way to write a line for a
// write that matched nothing, or to write nothing for a write that mattered.
//
// Source guard, read as CODE (`test/source-code.ts`): `actions.ts` is `"use server"` with
// `@tokophi/db` at module scope and cannot be imported here. Same shape as `add-store-user.test.ts`.
const RAW = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const ACTIONS = codeOnly(RAW);

function actionSource(src: string, name: string): string {
  const opener = `export async function ${name}`;
  const start = src.indexOf(opener);
  expect(start, `${name} not found — this guard is pointed at the wrong file`).toBeGreaterThan(-1);
  const rest = src.slice(start + opener.length);
  const end = rest.indexOf("export async function");
  return end === -1 ? rest : rest.slice(0, end);
}

const RETURNING = /\.\s*returning\s*\(/;
const before = (src: string, a: RegExp, b: RegExp) => {
  const ia = src.search(a);
  const ib = src.search(b);
  expect(ia, `${a} missing`).toBeGreaterThan(-1);
  expect(ib, `${b} missing`).toBeGreaterThan(-1);
  return ia < ib;
};

describe("SA-1 removeStoreUser — no audit line for a delete that matched nothing", () => {
  const fn = actionSource(ACTIONS, "removeStoreUser");

  it("reads the membership in THIS store, deletes with returning, and logs only after a row came back", () => {
    // The pre-read carries the store filter (the old one looked up `storeUserId` alone).
    expect(fn).toMatch(/storeUsers\s*\.\s*storeId\s*,\s*storeId/);
    expect(fn).toMatch(RETURNING);
    // Refuse on zero rows BEFORE the log line.
    expect(before(fn, /removed\s*\.\s*length/, /logStore\s*\(/)).toBe(true);
  });

  it("the predicate fires against the old shape", () => {
    const old = codeOnly(`
      export async function removeStoreUser(storeId, storeUserId) {
        const [su] = await db.select().from(schema.storeUsers).where(eq(schema.storeUsers.id, storeUserId)).limit(1);
        await db.delete(schema.storeUsers).where(and(eq(schema.storeUsers.id, storeUserId), eq(schema.storeUsers.storeId, storeId)));
        await logStore(storeId, "User dihapus");
        return { ok: true };
      }
    `);
    expect(old).not.toMatch(RETURNING);
  });
});

describe("SA-2 setStoreComped — an unknown store is a refusal, not a thrown FK", () => {
  const fn = actionSource(ACTIONS, "setStoreComped");

  it("updates with returning and refuses on zero rows before syncing or logging", () => {
    expect(fn).toMatch(RETURNING);
    // `codeOnly` inerts string contents, so the refusal is located by its CODE: the zero-row check.
    expect(before(fn, /updated\s*\.\s*length/, /syncStoredStatus\s*\(/)).toBe(true);
    expect(before(fn, /updated\s*\.\s*length/, /logStore\s*\(/)).toBe(true);
  });
});

describe("SA-4 savePaymentChannels — the enforced toggle leaves an audit line", () => {
  const fn = actionSource(ACTIONS, "savePaymentChannels");

  it("logs the channels it actually flipped, by label, naming the operator", () => {
    expect(fn).toMatch(RETURNING);
    expect(fn).toMatch(/logPlatform\s*\(/);
    expect(fn).toMatch(/admin\s*\.\s*email/);
  });

  it("the predicate fires against the old, silent shape", () => {
    const old = codeOnly(`
      export async function savePaymentChannels(updates) {
        for (const u of updates) {
          await db.update(schema.platformPaymentChannels).set({ enabled: u.on }).where(eq(schema.platformPaymentChannels.channel, u.key));
        }
        revalidatePath("/pengaturan");
        return { ok: true };
      }
    `);
    expect(old).not.toMatch(/logPlatform\s*\(/);
  });

  it("every other platform-config writer still logs too — the class, not the instance", () => {
    for (const name of ["saveGateways", "saveCouriers", "saveCodAllowed"]) {
      expect(actionSource(ACTIONS, name), name).toMatch(/logPlatform\s*\(/);
    }
  });
});
