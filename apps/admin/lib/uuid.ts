// The ONE implementation lives in `@tokophi/lib/uuid` so the super-admin can share it (page-map
// SA-3 + AD-1). Kept as a re-export so the existing `@/lib/uuid` imports need no change.
export { isUuid } from "@tokophi/lib/uuid";
