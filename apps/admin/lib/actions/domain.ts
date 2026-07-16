"use server";
import { schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import {
  domainRecords,
  getStoreDomains,
  systemDomainFor,
  domainKind,
  isLockedStatus,
  CNAME_TARGET,
  PLATFORM_ZONES,
  type StoreDomainRow,
} from "@/lib/data/domain";
import { getStoreSlug } from "@/lib/data/store";
import { createTicket } from "@/lib/actions/support";

// Custom-domain writes (Pengaturan → Domain). CUSTOM_DOMAIN.md.
//
// Every action is gated by RBAC (`settings:write`) and runs under the `tokophi_app` role via
// withTenant, so the RLS policy from migration 0050 is the tenant boundary — a merchant can only ever
// touch their own store's domains. `store_domains.host` is UNIQUE across the whole platform, so a host
// already claimed by ANOTHER store is rejected by the DB, not by an app-level check that could be
// forgotten.
//
// What this can and cannot do, honestly:
//  - add + verify TXT ownership is REAL and complete here.
//  - the jump to `active` (a shopper is actually served on the domain) needs a TLS cert, which is
//    Cloudflare-for-SaaS territory and is NOT built. So a verified domain rests at `provisioning`, and
//    the UI says so. It does NOT let the merchant flip it to `active` — that would render a domain the
//    platform cannot yet serve a cert for.

type Result = { ok: true } | { ok: false; error: string };

// Reads are exposed as a server action, not imported from lib/data directly: that module is
// `server-only`, and the card is a client component. `cnameTarget` rides along so the client never has
// to import the env-reading constant either.
export async function listDomains(): Promise<{
  rows: StoreDomainRow[];
  cnameTarget: string;
  systemDomain: string;
}> {
  const { storeId } = await requireCapability("settings:write", { allowSuspended: true });
  const slug = await getStoreSlug(storeId);
  return {
    rows: await getStoreDomains(),
    cnameTarget: CNAME_TARGET,
    systemDomain: slug ? systemDomainFor(slug) : "",
  };
}

/** lowercase, strip scheme/port/path/trailing dot. Mirrors the storefront's normalizeHost. */
function normalizeHost(input: string): string {
  return (input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

// A hostname, at least one dot, no scheme/space. Deliberately strict: this string becomes a UNIQUE
// key and a DNS lookup target.
const HOST_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export async function addDomain(input: string): Promise<Result> {
  const { storeId } = await requireCapability("settings:write");
  const host = normalizeHost(input);

  if (!HOST_RE.test(host)) {
    return { ok: false, error: "Format domain tidak valid. Contoh: toko.com atau www.toko.com" };
  }
  // SECURITY: a merchant may never attach any platform-owned zone (tokophi.id/.com/.cc) or a host
  // under it — that would let them squat `app.tokophi.com`, the `cname.tokophi.cc` fallback, or
  // another store's `<slug>.tokophi.id`. The store's own `<slug>.tokophi.id` is already served
  // automatically and is system-locked; there is nothing to add here.
  if (PLATFORM_ZONES.some((z) => host === z || host.endsWith(`.${z}`))) {
    return { ok: false, error: "Domain bawaan sistem tidak bisa ditambahkan. Masukkan domain milikmu sendiri (mis. toko-kamu.com)." };
  }

  const token = randomBytes(16).toString("hex"); // 32 hex

  try {
    return await withTenant(storeId, async (db) => {
      // One root + one www per store (Shopify's primary+redirect shape). Reject a second host of the
      // same kind — not a raw count, so the seller can't attach five random subdomains.
      const existing = await db
        .select({ host: schema.storeDomains.host })
        .from(schema.storeDomains)
        .where(eq(schema.storeDomains.storeId, storeId));
      const kind = domainKind(host);
      if (existing.some((e) => domainKind(e.host) === kind)) {
        return {
          ok: false,
          error:
            kind === "www"
              ? "Kamu sudah punya satu domain www. Batasnya satu domain utama + satu www."
              : "Kamu sudah punya satu domain utama. Batasnya satu domain utama + satu www (mis. namadomaintokomu.com dan www.namadomaintokomu.com).",
        };
      }
      await db.insert(schema.storeDomains).values({ storeId, host, verificationToken: token });
      await db.insert(schema.platformActivity).values({
        kind: "admin",
        storeId,
        text: `Domain ditambahkan: ${host}`,
      });
      revalidatePath("/pengaturan");
      return { ok: true };
    });
  } catch (e: unknown) {
    // The UNIQUE(host) violation is the important one: the host is taken by another store (or this one).
    const msg = String((e as { message?: string })?.message ?? e);
    if (/unique|duplicate/i.test(msg)) {
      return { ok: false, error: "Domain ini sudah terdaftar. Hubungi kami jika kamu yakin ini milikmu." };
    }
    return { ok: false, error: "Gagal menambahkan domain. Coba lagi." };
  }
}

export async function verifyDomain(id: string): Promise<Result> {
  const { storeId } = await requireCapability("settings:write");

  return withTenant(storeId, async (db) => {
    const [row] = await db
      .select({ host: schema.storeDomains.host, token: schema.storeDomains.verificationToken })
      .from(schema.storeDomains)
      .where(and(eq(schema.storeDomains.id, id), eq(schema.storeDomains.storeId, storeId)))
      .limit(1);
    if (!row) return { ok: false, error: "Domain tidak ditemukan." };

    const { txtName, txtValue } = domainRecords(row.host, row.token);

    let records: string[][] = [];
    try {
      records = await resolveTxt(txtName);
    } catch (e: unknown) {
      // ENOTFOUND/ENODATA just means "the record isn't there yet" — a normal, expected state, not an
      // error to log. Anything else, surface briefly.
      const code = (e as { code?: string })?.code;
      const notThere = code === "ENOTFOUND" || code === "ENODATA";
      const stamp = new Date();
      await db
        .update(schema.storeDomains)
        .set({
          status: "verifying",
          lastCheckedAt: stamp,
          lastError: notThere
            ? "Data TXT belum terbaca. DNS bisa perlu waktu hingga beberapa jam."
            : "Gagal membaca DNS. Coba lagi sebentar.",
        })
        .where(eq(schema.storeDomains.id, id));
      revalidatePath("/pengaturan");
      return { ok: false, error: notThere ? "Data TXT belum ditemukan. Tunggu propagasi DNS lalu coba lagi." : "Gagal membaca DNS." };
    }

    // resolveTxt returns each record as an array of string chunks — join them before comparing.
    const found = records.some((chunks) => chunks.join("") === txtValue);
    const stamp = new Date();

    if (!found) {
      await db
        .update(schema.storeDomains)
        .set({ status: "verifying", lastCheckedAt: stamp, lastError: "Nilai TXT belum cocok." })
        .where(eq(schema.storeDomains.id, id));
      revalidatePath("/pengaturan");
      return { ok: false, error: "Data TXT ditemukan tapi nilainya belum cocok. Pastikan disalin persis." };
    }

    // Ownership proven. It rests at `provisioning` — NOT `active` — because a TLS cert still has to be
    // issued (Cloudflare-for-SaaS, not built yet). The UI says "menunggu aktivasi".
    await db
      .update(schema.storeDomains)
      .set({ status: "provisioning", verifiedAt: stamp, lastCheckedAt: stamp, lastError: null })
      .where(eq(schema.storeDomains.id, id));
    await db.insert(schema.platformActivity).values({
      kind: "admin",
      storeId,
      text: `Domain terverifikasi: ${row.host}`,
    });
    revalidatePath("/pengaturan");
    return { ok: true };
  });
}

export async function setPrimaryDomain(id: string): Promise<Result> {
  const { storeId } = await requireCapability("settings:write");

  return withTenant(storeId, async (db) => {
    const [row] = await db
      .select({ host: schema.storeDomains.host, status: schema.storeDomains.status })
      .from(schema.storeDomains)
      .where(and(eq(schema.storeDomains.id, id), eq(schema.storeDomains.storeId, storeId)))
      .limit(1);
    if (!row) return { ok: false, error: "Domain tidak ditemukan." };
    if (row.status !== "active") {
      return { ok: false, error: "Hanya domain yang sudah aktif yang bisa dijadikan domain utama." };
    }
    // The partial unique index (store_id) WHERE is_primary forbids two primaries, so clear the others
    // in the SAME txn before setting this one.
    await db
      .update(schema.storeDomains)
      .set({ isPrimary: false })
      .where(eq(schema.storeDomains.storeId, storeId));
    await db.update(schema.storeDomains).set({ isPrimary: true }).where(eq(schema.storeDomains.id, id));
    revalidatePath("/pengaturan");
    return { ok: true };
  });
}

export async function removeDomain(id: string): Promise<Result> {
  const { storeId } = await requireCapability("settings:write");

  return withTenant(storeId, async (db) => {
    const [row] = await db
      .select({ host: schema.storeDomains.host, status: schema.storeDomains.status })
      .from(schema.storeDomains)
      .where(and(eq(schema.storeDomains.id, id), eq(schema.storeDomains.storeId, storeId)))
      .limit(1);
    if (!row) return { ok: false, error: "Domain tidak ditemukan." };

    // A domain whose ownership is proven (cert provisioning/live) is LOCKED: removing or swapping it
    // silently could point a live storefront at nothing, or free a host someone relies on. Changing it
    // is a platform decision — the seller raises a ticket (requestDomainChange), super-admin acts.
    if (isLockedStatus(row.status)) {
      return {
        ok: false,
        error: "Domain ini sudah terverifikasi dan dikunci. Ajukan perubahan lewat tiket — tim kami yang memprosesnya.",
      };
    }

    await db.delete(schema.storeDomains).where(eq(schema.storeDomains.id, id));
    await db.insert(schema.platformActivity).values({
      kind: "admin",
      storeId,
      text: `Domain dihapus: ${row.host}`,
    });
    revalidatePath("/pengaturan");
    return { ok: true };
  });
}

/** A verified/locked domain can't be self-served away — the seller asks the platform to change it, and
 *  that request becomes a support ticket super-admin picks up. Keeps a proven domain from being
 *  detached on a whim while still giving the merchant a clear, tracked path to change it. */
export async function requestDomainChange(id: string, note: string): Promise<Result> {
  const { storeId } = await requireCapability("settings:write");

  const host = await withTenant(storeId, async (db) => {
    const [row] = await db
      .select({ host: schema.storeDomains.host })
      .from(schema.storeDomains)
      .where(and(eq(schema.storeDomains.id, id), eq(schema.storeDomains.storeId, storeId)))
      .limit(1);
    return row?.host ?? null;
  });
  if (!host) return { ok: false, error: "Domain tidak ditemukan." };

  const reason = (note || "").trim().slice(0, 1000);
  const res = await createTicket(
    `Permintaan ubah domain: ${host}`,
    `Toko meminta perubahan/penghapusan domain terverifikasi \`${host}\`.\n\nAlasan: ${reason || "(tidak diisi)"}`,
  );
  if (!res.ok) return { ok: false, error: res.error ?? "Gagal membuat tiket." };

  await withTenant(storeId, async (db) => {
    await db.insert(schema.platformActivity).values({
      kind: "admin",
      storeId,
      text: `Permintaan ubah domain (tiket): ${host}`,
    });
  });
  revalidatePath("/pengaturan");
  return { ok: true };
}
