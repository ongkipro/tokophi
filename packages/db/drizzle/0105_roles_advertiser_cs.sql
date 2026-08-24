-- Owner request 2026-08-24: two specialist store roles — `advertiser` (marketing surface: pixels,
-- CAPI, feeds, promo, content) and `cs` (service desk: orders, customers, CRM, chat). Capability
-- grants live in apps/admin/lib/rbac-policy.ts; this only widens the enum. IF NOT EXISTS = idempotent.
ALTER TYPE "store_user_role" ADD VALUE IF NOT EXISTS 'advertiser';
ALTER TYPE "store_user_role" ADD VALUE IF NOT EXISTS 'cs';
