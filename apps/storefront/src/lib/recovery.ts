// The recovery token pair now lives in `@tokophi/lib/recovery` — see the long note there for WHY.
//
// Short version: the MINT belongs to the admin (the surface that lists abandoned carts and opens the
// WhatsApp message) and the VERIFY belongs here. While this module owned both, the admin could not
// import it, so `signRecoveryToken` had zero callers and no recovery link was ever created.
//
// This re-export is kept so the storefront's own import path does not change (`checkout.astro`), and
// because the storefront is the only place `verifyRecoveryToken` is ever called from.
export { signRecoveryToken, verifyRecoveryToken, recoveryUrl, RECOVERY_TTL } from "@tokophi/lib/recovery";
