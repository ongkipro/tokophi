"use server";
import { schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { encryptSecret, encryptionAvailable } from "@/lib/crypto";

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
  // Enabling browser tracking needs a valid pixel id; disabling can leave it blank.
  if (input.enabled && pixelId && !PIXEL_OK.test(pixelId)) {
    return { ok: false, error: "ID Pixel/Tag tidak valid (huruf, angka, - dan _ saja)." };
  }
  if (input.enabled && !pixelId) return { ok: false, error: "Isi ID Pixel/Tag dulu sebelum mengaktifkan." };

  // CAPI: only when a token exists (either stored or being set now). Encrypt a newly supplied token;
  // block enabling CAPI without an encryption key configured (never store a token plaintext).
  let tokenPatch: { capiTokenCiphertext?: string | null } = {};
  if (input.capiToken !== undefined) {
    const t = input.capiToken.trim();
    if (t) {
      if (!encryptionAvailable()) return { ok: false, error: "Kunci enkripsi (INTEGRATION_TOKEN_KEY) belum diset di server — token CAPI tidak bisa disimpan aman." };
      tokenPatch.capiTokenCiphertext = encryptSecret(t);
    } else {
      tokenPatch.capiTokenCiphertext = null; // explicit clear
    }
  }

  const base = {
    enabled: input.enabled,
    pixelId: pixelId || null,
    capiEnabled: input.capiEnabled,
    advancedMatching: input.advancedMatching,
    testEventCode: (input.testEventCode || "").trim() || null,
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
