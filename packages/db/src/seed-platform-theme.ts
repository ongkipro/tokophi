// Seed the PLATFORM DEFAULT THEME HOLDER — a store the platform owns, holding the default theme.
//
// WHY THIS FILE EXISTS. T-9's `PLATFORM_DEFAULT_THEME_STORE_ID` pointed at `batik-nusantara`'s LIVE
// rows, and `theme-source.ts` warned in its own doc comment that this is only acceptable while that
// store is ours: it makes one store's Store Builder a platform-wide control. (Owner decision
// 2026-08-12: the batik store — slug now `batiknusantara` — REMAINS the demo store; the default
// still moves off its live rows, because a platform-wide control must not live in any servable
// store.) The default lives here — a holder row with a FIXED id
// (`@tokophi/lib/platform-theme`) and a RESERVED slug, that no merchant can log into, register, or
// be served as. Point the env var at PLATFORM_THEME_STORE_ID and the platform default is a store the
// platform edits, never a live shop.
//
// ⚠️ Decision B (specs/docs/tasks/2026-08-06-open-work.md, UX-1): row-copies into MERCHANT stores were
// REJECTED — "the seed is not a migration". This file copies into the platform's OWN holder only,
// exactly once, and the storefront reads the holder at render time as a FALLBACK. No merchant's
// `page_templates` are written, ever.
//
// INSERT-IF-ABSENT throughout (the seed-products shape, NOT seed-templates' upsert): the holder's
// templates are edited afterwards via Super Admin impersonation ("Buka Dashboard Seller" on the
// holder), so a redeploy must never clobber that work. Idempotent and safe to wire into the deploy
// chain — a second run is a no-op.
//   npm run seed:platform-theme -w @tokophi/db
import { db, client, schema } from "./client";
import { eq } from "drizzle-orm";
import { PLATFORM_THEME_SLUG, PLATFORM_THEME_STORE_ID } from "@tokophi/lib/platform-theme";
import { PLATFORM_DEFAULT_TEMPLATES } from "./platform-theme-default";

// The holder needs an `accounts` parent (stores.account_id is NOT NULL). Fixed for the same reason
// the store id is: idempotency across deploys. Only this file uses it, so it lives here.
const PLATFORM_THEME_ACCOUNT_ID = "a0000000-0000-4000-8000-000000000000";

// 🔴 THE DEFAULT IS AUTHORED, NOT COPIED (2026-08-23). This script used to copy the demo store's
// `is_default` rows into the holder, tried across two slugs. The holder shape was right; the CONTENT
// was one shop's marketing, and with the fallback switched on it reached everybody: measured on
// production, ELEVEN live stores were publishing the batik store's homepage as their own — including
// `she-store`, which has zero products and rendered "Batik Modern untuk Hari-Harimu" over a button
// reading "Lihat Koleksi Dress" that pointed at a collection it does not have.
// The default now comes from `platform-theme-default.ts`, which is written to fit a shop selling
// anything. There is no source store any more, so there is no slug order to get wrong either.

const TEMPLATE_TYPES = ["homepage", "category", "product"] as const;

async function main() {
  // ── ① The holder store, if absent ─────────────────────────────────────────────────────────────
  let [holder] = await db
    .select({ id: schema.stores.id })
    .from(schema.stores)
    .where(eq(schema.stores.id, PLATFORM_THEME_STORE_ID))
    .limit(1);

  if (!holder) {
    // `stores.slug` is unique. The slug is in RESERVED_SLUGS so no creation path should ever have
    // minted it — but if a row somehow holds it (a hand-run SQL, a pre-reservation signup), refuse
    // LOUDLY instead of throwing a unique violation the non-fatal deploy chain would swallow into
    // "platform theme seed skipped" with no hint of why.
    const [squatter] = await db
      .select({ id: schema.stores.id, name: schema.stores.name })
      .from(schema.stores)
      .where(eq(schema.stores.slug, PLATFORM_THEME_SLUG))
      .limit(1);
    if (squatter) {
      console.error(
        `seed-platform-theme: slug "${PLATFORM_THEME_SLUG}" is already held by store ${squatter.id} ` +
          `("${squatter.name}") which is NOT the holder id ${PLATFORM_THEME_STORE_ID}. Resolve by hand.`,
      );
      process.exitCode = 1;
      await client.end();
      return;
    }

    await db
      .insert(schema.accounts)
      .values({ id: PLATFORM_THEME_ACCOUNT_ID, name: "TokoΦ Platform" })
      .onConflictDoNothing();

    await db.insert(schema.stores).values({
      id: PLATFORM_THEME_STORE_ID,
      accountId: PLATFORM_THEME_ACCOUNT_ID,
      name: "Tema Platform",
      slug: PLATFORM_THEME_SLUG,
      // NOT publicly servable, honestly: `store-servable.ts` gates on `suspendedAt` (never on
      // `status` — the billing cron rewrites that nightly, schema.ts says so at the column). The
      // reason column says what an operator finding this row needs to know: it is not a merchant.
      suspendedAt: new Date(),
      suspendedReason:
        "Platform default theme holder — bukan toko merchant. Holds the platform-wide default page_templates; never served publicly.",
      // `approvedAt` set: `approvedAt IS NULL` means "awaiting first review" (0090) and would park
      // this row in the operators' review queue forever, telling them a signup is waiting when
      // nothing is. This store was created deliberately, by the platform.
      approvedAt: new Date(),
      // Comped so the billing cron never invoices it, and honestly labelled. Comped is a BILLING
      // bypass only — the suspension above outranks it for serving (AGENTS.md), which is exactly the
      // combination wanted here: no bill, no storefront.
      comped: true,
      compedReason: "Platform theme holder — not billable.",
    });
    holder = { id: PLATFORM_THEME_STORE_ID };
    console.log(`seed-platform-theme: holder store created (${PLATFORM_THEME_STORE_ID}, slug "${PLATFORM_THEME_SLUG}").`);
  }

  // ── ② Copy the default templates the holder does not have yet ─────────────────────────────────
  // Only `is_default` rows (the platform default artefact — named variants stay the demo's own), and
  // only for TYPES the holder is missing: a type already present was either copied earlier or edited
  // since, and either way it is the platform's current default. Never overwrite it.
  const have = new Set(
    (
      await db
        .select({ type: schema.pageTemplates.type })
        .from(schema.pageTemplates)
        .where(eq(schema.pageTemplates.storeId, holder.id))
    ).map((r) => r.type),
  );
  const missing = TEMPLATE_TYPES.filter((t) => !have.has(t));

  if (missing.length === 0) {
    console.log("seed-platform-theme: holder already has all three template types — nothing to copy.");
    await client.end();
    return;
  }

  let written = 0;
  for (const type of missing) {
    const t = PLATFORM_DEFAULT_TEMPLATES[type];
    await db.insert(schema.pageTemplates).values({
      storeId: holder.id,
      type,
      name: t.name,
      sections: t.sections,
      isDefault: true,
    });
    written++;
  }

  console.log(
    `seed-platform-theme: wrote ${written} authored template(s) → holder ` +
      `(was missing: ${missing.join(", ") || "none"}).`,
  );
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
