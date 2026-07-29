"use server";
import { schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { encryptSecret, encryptionAvailable, secretScope } from "@/lib/crypto";

export type TrackingChannelKey = "meta" | "google" | "tiktok";

export type TrackingInput = {
  channel: TrackingChannelKey;
  enabled: boolean;
  pixelId: string;
  capiEnabled: boolean;
  advancedMatching: boolean;
  testEventCode: string;
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

  // CAPI: only when a token exists (either stored or being set now). Encrypt a newly supplied token;
  // block enabling CAPI without an encryption key configured (never store a token plaintext).
  let tokenPatch: { capiTokenCiphertext?: string | null } = {};
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
    advancedMatching: input.advancedMatching,
    testEventCode: testEventCode || null,
    updatedAt: new Date(),
  };

  const res = await withTenant(storeId, async (db) => {
    // Does a token already exist? (needed to validate "CAPI on" without a token, and to avoid wiping one)
    const [existing] = await db
      .select({ hasToken: schema.storeTrackingChannels.capiTokenCiphertext })
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
    return { ok: true as const };
  });

  if (res.ok) revalidatePath("/pemasaran");
  return res;
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
        ),
      )
      .returning({ id: schema.trackingEventDeliveries.id }),
  );

  revalidatePath("/pemasaran");
  return { ok: true, requeued: rows.length };
}
