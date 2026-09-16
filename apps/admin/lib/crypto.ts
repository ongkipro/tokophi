// The AES-256-GCM at-rest cipher lives in `@tokophi/lib/crypto` since Task 8.33 (2026-09-17): the
// platform's provider keys (KiriminAja / AutoLaris) are encrypted with the SAME primitive and
// decrypted by the DB loader in `packages/db`, which cannot import this app. This file stays so the
// three admin callers (tracking actions/data, the CAPI cron) and `crypto.test.ts` keep their import
// path; there is ONE implementation. The `server-only` guard lives HERE (the shared module cannot
// carry it — `tsx` scripts import it), so the app-side import path stays fenced off the client bundle.
import "server-only";
export { encryptionAvailable, encryptSecret, decryptSecret, secretScope } from "@tokophi/lib/crypto";
