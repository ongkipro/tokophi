import { getAdChannels } from "@/lib/data/marketing";
import { getFeedStatus } from "@/lib/data/feed";
import { getTrackingConfig, getTrackingHealth, getTrackingStatus, emptyTrackingConfig, emptyTrackingHealth } from "@/lib/data/tracking";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac-policy";
import { PemasaranClient } from "./pemasaran-client";

export const dynamic = "force-dynamic";

// The Pelacakan tab exposes a store's pixel ids, whether a server token is stored, and the last
// provider error — store-level integration configuration. `integrations:write` is owner-only (like
// `settings:write`), and ADR 0012 §7 puts the CAPABILITY in the chain, not just store membership.
//
// Gated HERE, on the read, not only on the controls: hiding a button is not access control (the rule
// `/obrolan` already follows for `chat:read`). The rest of the page — ad-channel overview, Katalog
// Iklan — stays open to every role, because none of it is a credential.
export default async function PemasaranPage() {
  const session = await getSession();
  const mayReadTracking = !!session && can(session.role, "integrations:write");

  const [channels, feed, status, tracking, health] = await Promise.all([
    getAdChannels(),
    getFeedStatus(),
    // Ungated on purpose — "is a pixel connected?" is not a credential, and deriving the badge from the
    // GATED config is what told every non-owner role that a live pixel was "Belum terhubung".
    getTrackingStatus(),
    mayReadTracking ? getTrackingConfig() : Promise.resolve(emptyTrackingConfig()),
    mayReadTracking ? getTrackingHealth() : Promise.resolve(emptyTrackingHealth()),
  ]);
  return (
    <PemasaranClient channels={channels} feed={feed} status={status} tracking={tracking} health={health} mayReadTracking={mayReadTracking} />
  );
}
