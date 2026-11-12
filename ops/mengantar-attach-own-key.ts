// Attach a Mengantar seller account the STORE OWNER already owns to ONE store — owner direction O11
// (2026-11-12, "untuk demo toko aman pakai itu"): until Mengantar issues TokoΦ's production Partner
// origin, the demo store `batiknusantara` ships with the owner's own Mengantar account. Not a seller
// feature: there is still no key field anywhere in the product (D13); this is an owner-run ops step.
//
// What it writes (one row, `store_mengantar_accounts`, this store + env):
//   state `connected`, `seller_id` = the account's `user_id` (read from GET /address), `partner_id` NULL
//   — the marker the code reads as "owner-attached": no partner regenerate, no partner get-key refresh —
//   the key sealed exactly as `connectStoreMengantar` seals one (AES-GCM, scope
//   `mengantar:<store>:<env>:<seller>:v<n>`), consent = the store's owner (`consent_source = owner_account`),
//   and optionally `pickup_address_id` = an address ALREADY registered on that account (so the first
//   booking does not register a duplicate pickup).
//
// REFUSALS: MENGANTAR_ENV must be named (`production` | `sandbox`); INTEGRATION_TOKEN_KEY must be the
// key of the TARGET deployment (a different key seals a blob the app cannot open); `--write` is needed to
// write anything (default = read-only check); the key must answer GET /address; every address must belong
// to ONE user_id; a given --pickup must be one of them.
//
// HOW TO RUN (from apps/admin; the key comes only through secrets-env, mapped in-process):
//   DATABASE_URL=<target> MENGANTAR_ENV=production INTEGRATION_TOKEN_KEY=<target's> \
//   NODE_OPTIONS="--import $PWD/../../ops/mengantar-live-hooks.mjs" \
//   secrets-env run -- npx tsx ../../ops/mengantar-attach-own-key.ts --store batiknusantara --pickup <address _id> [--write]
// The script reads the seller key from MENGANTAR_API_KEY (secrets-env) and never prints it.

const args = process.argv.slice(2);
const arg = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const WRITE = args.includes("--write");
const SLUG = arg("store")?.trim();
const PICKUP = arg("pickup")?.trim() || null;

function refuse(why: string): never {
  console.error(`mengantar-attach-own-key REFUSED: ${why}`);
  process.exit(2);
}
const say = (step: string, facts: Record<string, unknown>) => console.log(`[${step}]`, JSON.stringify(facts));

async function main() {
  const env = process.env.MENGANTAR_ENV;
  if (env !== "production" && env !== "sandbox") refuse("MENGANTAR_ENV must be exactly 'production' or 'sandbox'");
  if (!process.env.INTEGRATION_TOKEN_KEY || process.env.INTEGRATION_TOKEN_KEY.length < 16) refuse("INTEGRATION_TOKEN_KEY (the target deployment's) must be set");
  if (!SLUG) refuse("--store <slug> is required");
  if (PICKUP && !/^[0-9a-f]{24}$/.test(PICKUP)) refuse("--pickup must be a Mengantar address _id (24 hex)");
  const key = process.env.MENGANTAR_API_KEY?.trim();
  if (!key) refuse("MENGANTAR_API_KEY missing from secrets-env");

  const { MENGANTAR_ORIGINS } = await import("@tokophi/lib/provider-config");
  const { encryptSecret } = await import("@tokophi/lib/crypto");
  const { db, schema } = await import("@tokophi/db");
  const { mengantarKeyScope } = await import("@tokophi/db/mengantar-account");
  const { mengantarExternalUserId } = await import("@tokophi/lib/mengantar-partner");
  const { and, eq } = await import("drizzle-orm");

  // 1. The account answers, and its addresses name ONE owner (that user_id is the seller id).
  const base = MENGANTAR_ORIGINS[env].public;
  const res = await fetch(`${base}/api/public/${encodeURIComponent(key)}/address`, { headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) refuse(`GET /address answered HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { _id?: string; user_id?: string; PICKUP_NAME?: string }[] };
  const rows = Array.isArray(body.data) ? body.data : [];
  const owners = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v))];
  if (owners.length !== 1) refuse(`expected the addresses to name ONE user_id, got ${owners.length}`);
  const sellerId = owners[0];
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sellerId)) refuse("user_id does not fit the seller id format");
  if (PICKUP && !rows.some((r) => r._id === PICKUP)) refuse("--pickup is not an address of this account");
  say("account", { env, addresses: rows.length, sellerId, pickup: PICKUP ? rows.find((r) => r._id === PICKUP)?.PICKUP_NAME : null });

  // 2. The store and its owner (the consent is the owner's: it is their own Mengantar account).
  const [st] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.slug, SLUG!)).limit(1);
  if (!st) refuse(`no store with slug ${SLUG}`);
  const [owner] = await db
    .select({ userId: schema.storeUsers.userId })
    .from(schema.storeUsers)
    .where(and(eq(schema.storeUsers.storeId, st.id), eq(schema.storeUsers.role, "owner")))
    .orderBy(schema.storeUsers.acceptedAt)
    .limit(1);
  const T = schema.storeMengantarAccounts;
  const [cur] = await db.select({ state: T.state, v: T.keyVersion, sellerId: T.sellerId }).from(T).where(and(eq(T.storeId, st.id), eq(T.env, env))).limit(1);
  say("store", { slug: SLUG, storeId: st.id, owner: !!owner, current: cur ?? null });
  if (!WRITE) {
    say("check", { wrote: false, hint: "re-run with --write" });
    return;
  }

  // 3. Seal + write, the way `seal()` does (version bumps past any existing row).
  const version = (cur?.v ?? 0) + 1;
  const now = new Date();
  const set = {
    state: "connected",
    sellerId,
    partnerId: null,
    apiKeyEnc: encryptSecret(key!, mengantarKeyScope(st.id, env, sellerId, version)),
    keyVersion: version,
    keyHint: key!.slice(-4),
    connectedAt: now,
    pickupAddressId: PICKUP,
    consentSource: "owner_account",
    consentBy: owner?.userId ?? null,
    consentedAt: now,
    lastErrorCode: null,
    lastError: null,
    retryAfterAt: null,
    updatedAt: now,
  };
  const [w] = await db
    .insert(T)
    .values({ storeId: st.id, env, externalUserId: mengantarExternalUserId(st.id, env), ...set })
    .onConflictDoUpdate({ target: [T.storeId, T.env], set })
    .returning({ state: T.state, sellerId: T.sellerId, v: T.keyVersion, partnerId: T.partnerId, pickup: T.pickupAddressId });
  say("written", { ...w, at: now.toISOString() });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("mengantar-attach-own-key FAILED:", e instanceof Error ? e.name + ": " + e.message.replace(/[A-Za-z0-9]{32,}/g, "[REDACTED]") : e);
    process.exit(1);
  });
