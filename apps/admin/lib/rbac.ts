import "server-only";
import { getSession, type Session } from "@/lib/auth";
import { can, type Capability } from "@/lib/rbac-policy";
import { getBilling } from "@/lib/data/billing";
import { logImpersonation } from "@/lib/impersonation";

// Server-side RBAC guard. The role→capability matrix lives in the client-safe
// lib/rbac-policy.ts (shared with the UI). This module adds the enforcement that
// only runs on the server: read the session JWT + throw if the role lacks the cap.
export { can, ROLE_CAPS, ROLE_LABEL, type Role, type Capability } from "@/lib/rbac-policy";

export class ForbiddenError extends Error {
  readonly capability: Capability;
  constructor(cap: Capability) {
    super(`Akses ditolak — peran Anda tidak punya izin “${cap}”.`);
    this.name = "ForbiddenError";
    this.capability = cap;
  }
}

// Gate a server action. Returns the session (so callers get storeId/role/userId)
// or throws ForbiddenError when the current role lacks the capability.
// Two reasons a store is read-only, and they need two different sentences: an unpaid subscription
// is fixed by paying, an operator suspension is not (paying it will not unlock anything). Telling a
// merchant we locked for abuse to "bayar tagihan" invites a payment that changes nothing.
export class SuspendedError extends Error {
  constructor(reason?: string | null) {
    super(
      reason === undefined
        ? "Langganan ditangguhkan — aktifkan kembali (bayar tagihan) untuk menyimpan perubahan."
        : `Toko ditangguhkan oleh TokoΦ${reason ? ` — ${reason}` : ""}. Perubahan tidak bisa disimpan; hubungi kami lewat Bantuan.`,
    );
    this.name = "SuspendedError";
  }
}

// `allowSuspended` opts a capability out of the read-only/suspension check — used only by
// Bantuan (support tickets): a suspended store must still be able to contact us, since that
// is how it asks for help with the billing problem that suspended it.
export async function requireCapability(cap: Capability, opts?: { allowSuspended?: boolean }): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ForbiddenError(cap);
  if (!can(session.role, cap)) throw new ForbiddenError(cap);
  // subscription enforcement: past the grace period → read-only, block all writes.
  // (Paying re-activates via the langganan flow, which does not go through requireCapability.)
  if (!opts?.allowSuspended) {
    const bill = await getBilling();
    if (bill?.readOnly) throw new SuspendedError(bill.operatorSuspended ? bill.suspendedReason : undefined);
  }
  // 🔴 A WRITE MADE UNDER IMPERSONATION NAMES BOTH PARTIES (Task 4.11 / SEC-10). Before this, an
  // operator who entered a merchant's panel became indistinguishable from the merchant: the audit
  // trail ended at "Impersonate toko oleh …" and every subsequent change looked exactly like the
  // owner's own work — on our screens and on theirs. `platform_activity` carries `store_id` (the
  // merchant) and the line carries the operator, so a store's history can answer "who changed this,
  // and were they us?".
  //
  // ⚠️ THIS IS THE ONLY CHOKE POINT THERE IS, so it is the right one: every mutating server action
  // in `apps/admin` opens with `requireCapability` (AGENTS.md — "this is the security boundary"),
  // and there is nowhere else that sees ALL of them. Patch the class, not the instance.
  //
  // ⚠️ IT RECORDS AN AUTHORISATION, NOT AN OUTCOME, and the wording says so ("memakai izin"). The
  // write it precedes may still fail a validation or roll back; claiming here that data changed
  // would be the `markLabelsPrinted` mistake (report what you WROTE) pointed at the audit log.
  //
  // ⚠️ IT FAILS CLOSED. If the audit insert throws, the action throws with it and no write happens.
  // An unattributable operator write is precisely the state this requirement exists to forbid, and
  // the cost of the strict direction is one failed click during a database outage in which
  // everything else is failing anyway. Only impersonated sessions pay any of this: for a merchant's
  // own login the branch is one `if` on a field that is not there.
  if (session.imp) {
    await logImpersonation(
      session.storeId,
      `Operator ${session.imp.operatorEmail} memakai izin "${cap}" di panel Seller sebagai ${session.email} (impersonate)`,
    );
  }
  return session;
}
