// How the control plane mints a login credential — kept OUT of `actions.ts` for the same reason
// `platform-rank.ts` is: that file is `"use server"` and pulls `@tokophi/db` at module scope, so the
// rule guarding every account hand-over could not be tested without a database. This module is pure
// `node:crypto`, so `no-fixed-password.test.ts` can exercise it directly.
//
// 🔴 THERE IS NO FIXED PASSWORD HERE AND THERE MUST NEVER BE ONE AGAIN.
// `createStore` used to hash the literal `tokophi123` — a string published in this repository and in
// AGENTS.md — into the OWNER row of every store an operator onboarded. Knowing the merchant's email
// address was therefore a working login at app.tokophi.com as the shop's owner: every order (buyer
// name, WhatsApp, full delivery address), every customer record, and `settings:write` over the bank
// account and payout actions. `invitePlatformAdmin` had already been fixed and its comment claimed
// "the store-user add flow already does it this way" — `createStore`, the path that creates the
// merchant, was still on the constant.
//
// The rule (AGENTS.md, "Super Admin — the control plane reaches every tenant"): **never mint a fixed
// password. Random per mint, revealed once.** Every caller must therefore surface what it returns —
// an action that mints a password the UI drops on the floor locks the merchant out instead.
import { scryptSync, randomBytes } from "node:crypto";

/** A fresh, unguessable temp password to hand over ONCE. Never a constant, never derived from input. */
export const tempPassword = (): string => "tokophi-" + randomBytes(3).toString("hex");

/** scrypt `salt:hash` — the only form a password is ever stored in (matches `apps/admin/lib/auth.ts`). */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}
