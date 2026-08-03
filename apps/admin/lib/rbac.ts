import "server-only";
import { getSession, type Session } from "@/lib/auth";
import { can, type Capability } from "@/lib/rbac-policy";
import { getBilling } from "@/lib/data/billing";

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
  return session;
}
