export * from "./schema";
export { db, appDb, schema, client, appClient, assertRestrictedDbIdentity } from "./client";
export { withTenant } from "./rls";
export { resolveAreaCoords, type AreaCoords } from "./area-coords";
import { registerProviderConfigLoader } from "./provider-config";

// Task 8.33: every process that imports `@tokophi/db` resolves the KiriminAja / AutoLaris keys and
// environment from the database first (encrypted rows, 0111) and the container env second. The
// registration is a side effect of import on purpose — `packages/lib` cannot import this package,
// so the loader has to be handed over from here. No query runs until the first provider call.
registerProviderConfigLoader();
