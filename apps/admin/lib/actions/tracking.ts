"use server";
import { schema } from "@tokophi/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { decryptSecret, encryptSecret, encryptionAvailable, secretScope } from "@/lib/crypto";
import { probeGa4, probeMeta, probeTiktok } from "@/lib/capi";
import { rateLimit } from "@tokophi/lib/cache";

export type TrackingChannelKey = "meta" | "google" | "tiktok";

export type TrackingInput = {
  channel: TrackingChannelKey;
  enabled: boolean;
  pixelId: string;
  capiEnabled: boolean;
  testEventCode: string;
  /** Google Ads conversion destination, `AW-…/label`. Only meaningful on the `google` channel. */
  adsSendTo?: string;
  // CAPI token intent: undefined = leave stored token unchanged; "" = clear it; a string = set (encrypted).
  capiToken?: string;
};

const CHANNELS: TrackingChannelKey[] = ["meta", "google", "tiktok"];
// Loose id validation — accept what each platform actually issues; reject only obvious junk (spaces,
// wrong charset). Over-validation would refuse a real id and silently break a merchant's tracking.
const PIXEL_OK = /^[A-Za-z0-9_-]{4,64}$/;

export async function setTrackingChannel(input: TrackingInput): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("integrations:write");
  if (!CHANNELS.includes(input.channel)) return { ok: false, error: "Saluran tidak dikenal." };

  const pixelId = (input.pixelId || "").trim();
  // Validate whenever a value is present — NOT only when `enabled`. The id also travels to three
  // provider APIs from the cron (server-side tracking works with the browser pixel switched off), and
  // on the Meta/GA4 paths it is interpolated into a URL. One `encodeURIComponent` downstream is not
  // where a boundary check belongs.
  if (pixelId && !PIXEL_OK.test(pixelId)) {
    return { ok: false, error: "ID Pixel/Tag tidak valid (huruf, angka, - dan _ saja)." };
  }
  if (input.enabled && !pixelId) return { ok: false, error: "Isi ID Pixel/Tag dulu sebelum mengaktifkan." };
  const testEventCode = (input.testEventCode || "").trim();
  if (testEventCode && !/^[A-Za-z0-9_-]{1,64}$/.test(testEventCode)) {
    return { ok: false, error: "Kode uji tidak valid (huruf, angka, - dan _ saja, maks 64)." };
  }
  // Google Ads conversion destination. Validated to Google's own documented shape — `AW-` + the numeric
  // conversion id + `/` + the action label — because a typo here does not error anywhere: gtag accepts
  // any string and the conversion simply never appears in Google Ads.
  const adsSendTo = (input.adsSendTo || "").trim();
  if (adsSendTo && !/^AW-\d{6,14}\/[A-Za-z0-9_-]{6,40}$/.test(adsSendTo)) {
    return { ok: false, error: "Tujuan konversi Google Ads harus berbentuk AW-123456789/AbC-D_efGh." };
  }
  if (adsSendTo && input.channel !== "google") {
    return { ok: false, error: "Tujuan konversi Google Ads hanya untuk saluran Google." };
  }

  // CAPI: only when a token exists (either stored or being set now). Encrypt a newly supplied token;
  // block enabling CAPI without an encryption key configured (never store a token plaintext).
  const tokenPatch: { capiTokenCiphertext?: string | null } = {};
  if (input.capiToken !== undefined) {
    const t = input.capiToken.trim();
    if (t) {
      if (!encryptionAvailable()) return { ok: false, error: "Kunci enkripsi (INTEGRATION_TOKEN_KEY) belum diset di server — token CAPI tidak bisa disimpan aman." };
      // Bound to (store, channel): a blob moved to another row cannot be decrypted (lib/crypto.ts).
      tokenPatch.capiTokenCiphertext = encryptSecret(t, secretScope(storeId, input.channel));
    } else {
      tokenPatch.capiTokenCiphertext = null; // explicit clear
    }
  }

  const base = {
    enabled: input.enabled,
    pixelId: pixelId || null,
    capiEnabled: input.capiEnabled,
    // Advanced matching is ALWAYS ON (owner ruling 2026-08-24) — the column is written true so old
    // rows converge, but nothing reads it anymore; the storefront and CAPI attach hashed
    // identifiers unconditionally.
    advancedMatching: true,
    testEventCode: testEventCode || null,
    adsSendTo: adsSendTo || null,
    updatedAt: new Date(),
  };

  const res = await withTenant(storeId, async (db) => {
    // Does a token already exist? (needed to validate "CAPI on" without a token, and to avoid wiping one)
    const [existing] = await db
      .select({ hasToken: schema.storeTrackingChannels.capiTokenCiphertext, pixelId: schema.storeTrackingChannels.pixelId })
      .from(schema.storeTrackingChannels)
      .where(and(eq(schema.storeTrackingChannels.storeId, storeId), eq(schema.storeTrackingChannels.channel, input.channel)))
      .limit(1);
    const willHaveToken =
      tokenPatch.capiTokenCiphertext !== undefined ? !!tokenPatch.capiTokenCiphertext : !!existing?.hasToken;
    if (base.capiEnabled && !willHaveToken) {
      return { ok: false as const, error: "Aktifkan CAPI perlu token akses server dulu." };
    }
    await db
      .insert(schema.storeTrackingChannels)
      .values({ storeId, channel: input.channel, ...base, ...tokenPatch })
      .onConflictDoUpdate({
        target: [schema.storeTrackingChannels.storeId, schema.storeTrackingChannels.channel],
        set: { ...base, ...tokenPatch },
      });

    // Audit trail (ADR 0012 §25 — "sensitive operations MUST create audit entries"), the same place
    // and shape the domain actions use. A pixel id or a token changing is how conversions silently
    // stop; without this, "who changed it, and when" has no answer at all. NEVER the value itself.
    const changes: string[] = [];
    if ((existing?.pixelId ?? null) !== (base.pixelId ?? null)) changes.push("ID Pixel diubah");
    if (tokenPatch.capiTokenCiphertext === null && existing?.hasToken) changes.push("token server dihapus");
    else if (tokenPatch.capiTokenCiphertext) changes.push(existing?.hasToken ? "token server diganti" : "token server ditambahkan");
    if (changes.length) {
      await db.insert(schema.platformActivity).values({
        kind: "admin",
        storeId,
        text: `Pelacakan ${input.channel}: ${changes.join(", ")}`,
      });
    }
    return { ok: true as const };
  });

  if (res.ok) revalidatePath("/pemasaran");
  return res;
}

/**
 * Remove the stored server-side token for a channel, and switch CAPI off with it.
 *
 * This exists because there was no way to do it: the editor only ever sent `capiToken: undefined`
 * ("leave unchanged"), so the clear branch in `setTrackingChannel` was unreachable code and a merchant
 * who fired the agency that pasted their token could not revoke it from TokoΦ. ADR 0012 §17.3 item 6.
 */
export async function clearTrackingToken(channel: TrackingChannelKey): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("integrations:write");
  if (!CHANNELS.includes(channel)) return { ok: false, error: "Saluran tidak dikenal." };
  await withTenant(storeId, async (db) => {
    // `returning()` so the audit entry describes something that ACTUALLY happened — a double-click, or
    // a click when no token was stored, must not leave a log claiming a deletion.
    const cleared = await db
      .update(schema.storeTrackingChannels)
      .set({ capiTokenCiphertext: null, capiEnabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.storeTrackingChannels.storeId, storeId),
          eq(schema.storeTrackingChannels.channel, channel),
          sql`${schema.storeTrackingChannels.capiTokenCiphertext} is not null`,
        ),
      )
      .returning({ id: schema.storeTrackingChannels.id });
    if (cleared.length) {
      await db.insert(schema.platformActivity).values({
        kind: "admin",
        storeId,
        text: `Pelacakan ${channel}: token server dihapus`,
      });
    }
  });
  revalidatePath("/pemasaran");
  return { ok: true };
}

/**
 * Requeue this channel's failed conversions (ADR 0012 §21 "retry failed jobs", §16 "expose remediation
 * guidance in Admin").
 *
 * Without this, `dead_letter` is a one-way door: rotate `INTEGRATION_TOKEN_KEY`, or paste a token with
 * a typo, and every conversion from that window is lost even after the merchant fixes the cause. The
 * remediation message told them what to do and then there was nothing to do it WITH.
 *
 * Bounded to the last 7 days — the providers reject events older than their own windows (Meta 7 days,
 * GA4 72 hours), so offering to resend a month-old conversion would only manufacture new failures.
 */
export async function retryTrackingDeliveries(channel: TrackingChannelKey): Promise<{ ok: boolean; requeued?: number; error?: string }> {
  const { storeId } = await requireCapability("integrations:write");
  if (!CHANNELS.includes(channel)) return { ok: false, error: "Saluran tidak dikenal." };
  // Each click buys a fresh attempt budget against a live provider. Unbounded, a merchant hammering the
  // button after a revoked token turns into hundreds of rejected calls from our IP.
  if (!rateLimit(`tracking-retry:${storeId}`, 5, 60_000).ok) {
    return { ok: false, error: "Terlalu sering mencoba. Tunggu semenit lalu ulangi." };
  }

  const rows = await withTenant(storeId, async (db) =>
    db
      .update(schema.trackingEventDeliveries)
      .set({ status: "queued", attemptCount: 0, nextAttemptAt: new Date(), lastErrorCode: null, lastErrorMessage: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.trackingEventDeliveries.storeId, storeId),
          eq(schema.trackingEventDeliveries.channel, channel),
          eq(schema.trackingEventDeliveries.status, "dead_letter"),
          sql`${schema.trackingEventDeliveries.createdAt} > now() - interval '7 days'`,
          // Codes that describe the EVENT, not the configuration, can never succeed on a retry: the
          // order has no email/phone, or the provider refused the payload outright. Requeuing them just
          // spends the budget and puts the same failure back on the merchant's screen.
          sql`coalesce(${schema.trackingEventDeliveries.lastErrorCode}, '') not in ('no_identity','too_old')`,
        ),
      )
      .returning({ id: schema.trackingEventDeliveries.id }),
  );

  revalidatePath("/pemasaran");
  return { ok: true, requeued: rows.length };
}

/**
 * Switch this store's catalog id scheme to the stable one (ADR 0013).
 *
 * ⚠️ ONE-WAY IN PRACTICE, and the UI must say so before calling this. The id is a catalog item's
 * primary key at all three providers and none of them offers a re-key: Google "overwrites your product
 * and its history", Meta deletes and recreates the item, and any retargeting audience built on the old
 * `content_ids` stops matching. That is why the switch is a merchant decision with a warning rather
 * than something a migration did to them.
 *
 * There is deliberately no path back. Flipping to `handle` again would re-key a second time, i.e. pay
 * the same cost twice for a scheme we know is unstable.
 */
export async function switchToStableCatalogIds(): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("integrations:write");
  await withTenant(storeId, async (db) => {
    // Only when it actually changes: a second click must not log a second migration.
    const moved = await db
      .update(schema.stores)
      .set({ catalogIdScheme: "number" })
      .where(and(eq(schema.stores.id, storeId), ne(schema.stores.catalogIdScheme, "number")))
      .returning({ id: schema.stores.id });
    if (moved.length) {
      await db.insert(schema.platformActivity).values({
        kind: "admin",
        storeId,
        text: "Katalog: ID produk dipindah ke penomoran stabil (ADR 0013)",
      });
    }
  });
  revalidatePath("/pemasaran");
  revalidatePath("/produk");
  return { ok: true };
}

/**
 * "Is this credential real, and does it reach this pixel?" — asked on demand, before the merchant's
 * first sale instead of after a week of dead-lettered conversions.
 *
 * The token is decrypted transiently HERE and never returned; only a verdict crosses back. Rate-limited
 * because each call hits a live provider, and gated by the same owner-only capability as saving it.
 */
export async function testTrackingConnection(channel: TrackingChannelKey): Promise<{ ok: boolean; message: string }> {
  const { storeId } = await requireCapability("integrations:write");
  if (!CHANNELS.includes(channel)) return { ok: false, message: "Saluran tidak dikenal." };
  if (!rateLimit(`tracking-test:${storeId}:${channel}`, 10, 60_000).ok) {
    return { ok: false, message: "Terlalu sering menguji. Tunggu semenit lalu ulangi." };
  }

  const cfg = await withTenant(storeId, async (db) => {
    const [row] = await db
      .select({ pixelId: schema.storeTrackingChannels.pixelId, cipher: schema.storeTrackingChannels.capiTokenCiphertext })
      .from(schema.storeTrackingChannels)
      .where(and(eq(schema.storeTrackingChannels.storeId, storeId), eq(schema.storeTrackingChannels.channel, channel)))
      .limit(1);
    return row ?? null;
  });
  const pixelId = cfg?.pixelId?.trim();
  if (!pixelId) return { ok: false, message: "Isi ID Pixel/Tag dulu." };
  const token = decryptSecret(cfg?.cipher ?? null, secretScope(storeId, channel));
  if (!token) {
    return {
      ok: false,
      message: cfg?.cipher
        ? "Token tersimpan tidak bisa dibaca (kunci enkripsi server berubah). Tempel ulang tokennya."
        : "Belum ada token akses server untuk diuji.",
    };
  }

  if (channel === "meta") return probeMeta(pixelId, token);
  if (channel === "tiktok") return probeTiktok(pixelId, token);
  return probeGa4(pixelId, token);
}
