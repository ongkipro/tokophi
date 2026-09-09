// Pure decision helpers for "is this platform integration / payment channel ACTIVE?".
// No network, no env, no `server-only` — safe to import anywhere and to unit-test.

// Every AutoLaris H2H response is an ENVELOPE: HTTP 200 with `rc` carrying the real outcome, so
// `rc === "00"` must be checked before `data` is consumed. Single source of that rule so every
// caller in the repo agrees.
//
// ⚠️ THE COMMENT HERE USED TO SAY "AutoLaris H2H has NO list-channels endpoint" AND IT WAS WRONG.
// `GET /api/h2h/list_payment` exists and is documented as "Channel aktif dan konfigurasi fee akun"
// (verified live 2026-09-09). Channel availability is read from THAT, never from firing a
// create_payment per channel — which created a real, abandoned bill for every code probed.
// `channelActiveFromRc` is kept because rc="07" (channel not enabled) is still the answer a real
// create_payment can give at checkout time; it is no longer a discovery mechanism.
export const AUTOLARIS_RC_OK = "00";
export const channelActiveFromRc = (rc: string | null | undefined): boolean => rc === AUTOLARIS_RC_OK;

// An integration counts as "configured/connected" when its credential is a non-empty string.
// (Both KiriminAja and AutoLaris gate on a Bearer key present in env.)
export const isConfigured = (key: string | null | undefined): boolean => !!key && key.trim().length > 0;
