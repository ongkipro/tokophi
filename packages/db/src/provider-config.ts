import { eq } from "drizzle-orm";
import { db } from "./client";
import { platformPaymentGateways, shippingAggregator, shippingProviderConfig } from "./schema";
import { decryptSecret, encryptSecret } from "@tokophi/lib/crypto";
import {
  invalidateProviderConfig,
  isProviderEnv,
  setProviderConfigLoader,
  type ProviderEnv,
  type ProviderRows,
} from "@tokophi/lib/provider-config";

// The DB half of the provider-config seam (Task 8.33). `@tokophi/lib/provider-config` owns the
// precedence rule and the cache; THIS module owns the query and the cipher, and registers itself as
// the loader when `@tokophi/db` is imported (see index.ts) — so every process that can reach the
// database resolves keys from it, and a process that cannot (a unit test) resolves from env.
//
// OWNER pool, deliberately: the rows are platform-wide, there is no tenant to scope by (AGENTS.md
// "you cannot fix an owner path by moving it to the restricted pool").
//
// The plaintext key never leaves the loader's return value; callers get it only through the resolved
// config, and the Super Admin surface gets `maskKey()` of it.

/** The GCM scope binds each blob to its column — a sandbox blob pasted into the production column does not decrypt. */
export const providerSecretScope = (provider: "kiriminaja", env: ProviderEnv): string => `provider:${provider}:${env}`;
export const AUTOLARIS_SECRET_SCOPE = "provider:autolaris:key";
/** 0116: the Mengantar PARTNER secret, one blob per environment (a sandbox blob does not decrypt as production). */
export const mengantarPartnerScope = (env: ProviderEnv): string => `provider:mengantar:partner:${env}`;

/** The first (and only) aggregator row for KiriminAja, or null. There is one row per provider by construction (seed). */
export async function kiriminajaRow() {
  const [row] = await db.select().from(shippingAggregator).where(eq(shippingAggregator.provider, "kiriminaja")).limit(1);
  return row ?? null;
}

export async function autolarisRow() {
  const [row] = await db.select().from(platformPaymentGateways).where(eq(platformPaymentGateways.provider, "autolaris")).limit(1);
  return row ?? null;
}

/** The platform shipping switch row (0116, singleton id = 1), or null before the migration ran. */
export async function shippingConfigRow() {
  const [row] = await db.select().from(shippingProviderConfig).where(eq(shippingProviderConfig.id, 1)).limit(1);
  return row ?? null;
}

/** Decrypts the stored keys; a blob that fails to decrypt (wrong key, tampered, wrong scope) reads as absent. */
export async function loadProviderRows(): Promise<ProviderRows> {
  const [ka, al, sp] = await Promise.all([kiriminajaRow(), autolarisRow(), shippingConfigRow()]);
  return {
    kiriminaja: ka
      ? {
          activeEnv: ka.activeEnv,
          sandboxKey: decryptSecret(ka.sandboxKeyEnc, providerSecretScope("kiriminaja", "sandbox")),
          productionKey: decryptSecret(ka.productionKeyEnc, providerSecretScope("kiriminaja", "production")),
          sandboxOrderPrefix: ka.sandboxOrderPrefix,
          productionOrderPrefix: ka.productionOrderPrefix,
        }
      : null,
    autolaris: al ? { key: decryptSecret(al.credentialsEnc, AUTOLARIS_SECRET_SCOPE) } : null,
    mengantar: sp
      ? {
          sandboxPartnerId: sp.mengantarSandboxPartnerId,
          sandboxPartnerSecret: decryptSecret(sp.mengantarSandboxPartnerSecretEnc, mengantarPartnerScope("sandbox")),
          productionPartnerId: sp.mengantarProductionPartnerId,
          productionPartnerSecret: decryptSecret(sp.mengantarProductionPartnerSecretEnc, mengantarPartnerScope("production")),
        }
      : null,
    shipping: sp ? { activeProvider: sp.activeProvider } : null,
  };
}

/** Wire the loader into the shared seam. Idempotent; called once from index.ts. */
export function registerProviderConfigLoader(): void {
  setProviderConfigLoader(loadProviderRows);
}

// ---------------------------------------------------------------------------------------------
// Writers — used by the Super Admin actions. Each one invalidates the in-process cache so the replica
// that took the write answers with the new value at once (other replicas within the TTL).

/** Store one KiriminAja key for one environment, encrypted. Creates the row if the seed never did. */
export async function writeKiriminajaKey(env: ProviderEnv, plaintext: string): Promise<void> {
  if (!isProviderEnv(env)) throw new Error(`unknown provider env: ${String(env)}`);
  const blob = encryptSecret(plaintext, providerSecretScope("kiriminaja", env));
  const col = env === "production" ? { productionKeyEnc: blob, productionTestedAt: null } : { sandboxKeyEnc: blob, sandboxTestedAt: null };
  const existing = await kiriminajaRow();
  if (existing) await db.update(shippingAggregator).set(col).where(eq(shippingAggregator.id, existing.id));
  else await db.insert(shippingAggregator).values({ provider: "kiriminaja", enabled: true, ...col });
  invalidateProviderConfig();
}

/** Stamp the moment a stored KiriminAja key passed its live test. */
export async function markKiriminajaTested(env: ProviderEnv, at = new Date()): Promise<void> {
  const col = env === "production" ? { productionTestedAt: at } : { sandboxTestedAt: at };
  await db.update(shippingAggregator).set(col).where(eq(shippingAggregator.provider, "kiriminaja"));
  invalidateProviderConfig();
}

/** Flip the environment the platform books against. The CALLER proves the target key works first. */
export async function writeKiriminajaActiveEnv(env: ProviderEnv): Promise<void> {
  if (!isProviderEnv(env)) throw new Error(`unknown provider env: ${String(env)}`);
  const existing = await kiriminajaRow();
  if (existing) await db.update(shippingAggregator).set({ activeEnv: env }).where(eq(shippingAggregator.id, existing.id));
  else await db.insert(shippingAggregator).values({ provider: "kiriminaja", enabled: true, activeEnv: env });
  invalidateProviderConfig();
}

/** 0115: the order_id prefix for one env's account. The action validates the shape; this only stores it. */
export async function writeKiriminajaOrderPrefix(env: ProviderEnv, prefix: string): Promise<void> {
  const existing = await kiriminajaRow();
  const col = env === "production" ? { productionOrderPrefix: prefix } : { sandboxOrderPrefix: prefix };
  if (existing) await db.update(shippingAggregator).set(col).where(eq(shippingAggregator.id, existing.id));
  else await db.insert(shippingAggregator).values({ provider: "kiriminaja", enabled: true, ...col });
  invalidateProviderConfig();
}

export async function writeAutolarisKey(plaintext: string): Promise<void> {
  const blob = encryptSecret(plaintext, AUTOLARIS_SECRET_SCOPE);
  const existing = await autolarisRow();
  if (existing) await db.update(platformPaymentGateways).set({ credentialsEnc: blob, testedAt: null }).where(eq(platformPaymentGateways.id, existing.id));
  else await db.insert(platformPaymentGateways).values({ provider: "autolaris", enabled: true, isCod: false, credentialsEnc: blob });
  invalidateProviderConfig();
}

export async function markAutolarisTested(at = new Date()): Promise<void> {
  await db.update(platformPaymentGateways).set({ testedAt: at }).where(eq(platformPaymentGateways.provider, "autolaris"));
  invalidateProviderConfig();
}

// ── 0116 (SHIP-MENGANTAR) writers — the Super Admin is the only caller, behind owner rank ────────────
async function ensureShippingRow() {
  await db.insert(shippingProviderConfig).values({ id: 1 }).onConflictDoNothing();
}

/**
 * Store the Mengantar PARTNER credential for one environment (owner O1: swappable — the GeraiExpress
 * partner today, possibly TokoΦ's own later). The id is not secret; the secret is sealed. Seller rows
 * record which partner id registered them, so a swap is visible per store.
 */
export async function writeMengantarPartner(env: ProviderEnv, partnerId: string, secret: string): Promise<void> {
  if (!isProviderEnv(env)) throw new Error(`unknown provider env: ${String(env)}`);
  await ensureShippingRow();
  const blob = encryptSecret(secret, mengantarPartnerScope(env));
  const set =
    env === "production"
      ? { mengantarProductionPartnerId: partnerId, mengantarProductionPartnerSecretEnc: blob, updatedAt: new Date() }
      : { mengantarSandboxPartnerId: partnerId, mengantarSandboxPartnerSecretEnc: blob, updatedAt: new Date() };
  await db.update(shippingProviderConfig).set(set).where(eq(shippingProviderConfig.id, 1));
  invalidateProviderConfig();
}

/**
 * Flip which provider QUOTES new checkouts. Existing orders keep their own `shipping_provider` stamp.
 * Returns what was WRITTEN (re-read), never what was asked — the caller audit-logs the outcome.
 * The CALLER enforces owner rank, the reason, and the readiness checks (partner credential present).
 */
export async function writeActiveShippingProvider(provider: "kiriminaja" | "mengantar"): Promise<string> {
  if (provider !== "kiriminaja" && provider !== "mengantar") throw new Error(`unknown shipping provider: ${String(provider)}`);
  await ensureShippingRow();
  const [row] = await db
    .update(shippingProviderConfig)
    .set({ activeProvider: provider, updatedAt: new Date() })
    .where(eq(shippingProviderConfig.id, 1))
    .returning({ activeProvider: shippingProviderConfig.activeProvider });
  invalidateProviderConfig();
  return row?.activeProvider ?? provider;
}
