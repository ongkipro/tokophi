// Pure decision helpers for "is this platform integration / payment channel ACTIVE?".
// No network, no env, no `server-only` — safe to import anywhere and to unit-test.

// AutoLaris H2H has NO list-channels endpoint. We discover which channels the platform account
// has active by calling create_payment and reading the response code: rc="00" = active on the
// account, anything else (commonly rc="07" = channel not enabled) = not active. Single source of
// that rule so the probe, the checkout create-payment path, and the tests can't drift apart.
export const AUTOLARIS_RC_OK = "00";
export const channelActiveFromRc = (rc: string | null | undefined): boolean => rc === AUTOLARIS_RC_OK;

// An integration counts as "configured/connected" when its credential is a non-empty string.
// (Both KiriminAja and AutoLaris gate on a Bearer key present in env.)
export const isConfigured = (key: string | null | undefined): boolean => !!key && key.trim().length > 0;
