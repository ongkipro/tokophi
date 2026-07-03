"use client";
import * as React from "react";
import { can as policyCan, type Capability, type Role } from "@/lib/rbac-policy";

// Carries the current user's role to client components so they can hide/disable
// controls the role can't use. This mirrors the server-side guard (lib/rbac.ts) —
// it's UX only; the server action is still the security boundary.
const RoleContext = React.createContext<Role | undefined>(undefined);

export function PermissionsProvider({ role, children }: { role?: string; children: React.ReactNode }) {
  return <RoleContext.Provider value={role as Role | undefined}>{children}</RoleContext.Provider>;
}

export function useRole(): Role | undefined {
  return React.useContext(RoleContext);
}

// useCan("products:delete") → boolean. Owner defaults to allowed if no provider
// (defensive: an ungated tree shouldn't hide everything).
export function useCan(cap: Capability): boolean {
  const role = React.useContext(RoleContext);
  return policyCan(role, cap);
}

// <Can capability="products:write">…</Can> — renders children only when allowed.
// Optional `fallback` shows something else (e.g. a disabled hint) when denied.
export function Can({
  capability,
  children,
  fallback = null,
}: {
  capability: Capability;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return useCan(capability) ? <>{children}</> : <>{fallback}</>;
}
