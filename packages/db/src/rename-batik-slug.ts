// One-off DATA rename: the demo store's slug `batik-nusantara` → `batiknusantara` (owner decision,
// 2026-08-12). The slug IS the storefront hostname (`<slug>.tokophi.id`, ADR 0009), so this one
// UPDATE is what moves the shop to https://batiknusantara.tokophi.id. Deliberately NOT a drizzle
// migration: it changes a row, not the schema, and a migration would be the wrong tool for a value
// the seed also writes.
//
// Runs in the deploy migrate chain (docker-compose.coolify.yml) AFTER `seed.ts` — which on a FRESH
// database creates the store, already under the new slug — and BEFORE every demo seed script
// (`seed-templates` / `seed-journal` / `seed-products` / …): those look the store up BY SLUG, so on
// an EXISTING database they must find it under the new one or they all "skip" and the demo quietly
// stops receiving its content.
//
// IDEMPOTENT, three states, never throws on a re-run:
//   · old slug absent            → nothing to do (fresh DB, or already renamed) — the normal state
//   · BOTH slugs present         → REFUSE loudly. `stores.slug` is how the Host header picks a
//                                  tenant; renaming over an existing `batiknusantara` would either
//                                  violate uniqueness or hand one merchant's hostname to another.
//                                  A human has to look, so say so instead of half-acting.
//   · old present, new absent    → the one-row UPDATE.
//
//   npm run rename:batik-slug -w @tokophi/db
import { db, client } from "./client";
import { sql } from "drizzle-orm";

const OLD = "batik-nusantara";
const NEW = "batiknusantara";

async function main() {
  const rows = (await db.execute(
    sql`select slug from stores where slug in (${OLD}, ${NEW})`,
  )) as unknown as Array<{ slug: string }>;
  const has = new Set(rows.map((r) => r.slug));

  if (!has.has(OLD)) {
    console.log(`✓ Slug rename: no store '${OLD}' — nothing to do (already '${NEW}' or fresh DB).`);
    return;
  }
  if (has.has(NEW)) {
    console.log(`⚠ Slug rename REFUSED: both '${OLD}' and '${NEW}' exist — resolve by hand.`);
    return;
  }
  await db.execute(sql`update stores set slug = ${NEW} where slug = ${OLD}`);
  console.log(`✓ Store slug renamed: '${OLD}' → '${NEW}'.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
