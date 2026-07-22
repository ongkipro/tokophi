/**
 * VERIFY THE MIGRATION JOURNAL — the three ways it has actually broken, checked mechanically.
 *
 * Run:  npm run verify-migrations -w @tokophi/db          (offline: journal + files only)
 *       npm run verify-migrations -w @tokophi/db -- --db  (also compares against a live database)
 *
 * Every check here exists because the failure happened, not because it is conceivable:
 *
 * 1. **A `when` that does not increase.** drizzle applies entries whose `when` is greater than the
 *    newest one the target database has already recorded — so an entry stamped BELOW an earlier one
 *    is skipped **while `migrate` prints "applied successfully"**. `0048` shipped with a future
 *    timestamp once and silently swallowed a truthfully-stamped `0049`; on 2026-07-22 a new migration
 *    was written with a stamp two days behind production's newest and would have been skipped the
 *    same way. This is the check that would have caught both.
 *
 * 2. **A duplicated index.** Two branches open at the same time both write `0064_*`, because each one
 *    only looked at its own journal. Merged, the folder drizzle orders by has two `0064`s.
 *
 * 3. **A journal entry with no SQL file, or a SQL file no journal entry names.** Either way one of the
 *    two is lying about what the database will be asked to run.
 *
 * With `--db` it also answers the question no local check can: **is my newest stamp above the one the
 * TARGET database already holds?** Point `DATABASE_URL` at production and it tells you whether the
 * next deploy will actually run your migration or quietly skip it.
 *
 * Exits non-zero on any failure, so it can gate a release.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Entry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, "..", "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

const problems: string[] = [];
const note = (s: string) => problems.push(s);

if (!existsSync(journalPath)) {
  console.error(`✗ Tidak menemukan journal di ${journalPath}`);
  process.exit(1);
}

const entries: Entry[] = JSON.parse(readFileSync(journalPath, "utf8")).entries;
console.log(`Journal: ${entries.length} entri, terakhir ${entries.at(-1)?.tag}\n`);

// 1. `when` must strictly increase — this is the ordering drizzle actually applies, and the only one.
for (let i = 1; i < entries.length; i += 1) {
  const prev = entries[i - 1];
  const cur = entries[i];
  if (cur.when <= prev.when) {
    note(
      `when TIDAK NAIK: ${cur.tag} (${cur.when}) <= ${prev.tag} (${prev.when}).\n` +
        `    drizzle akan MELEWATI '${cur.tag}' sambil melapor sukses.`,
    );
  }
}

// 2. indices unique and sequential — a duplicate means two branches numbered independently.
const byIdx = new Map<number, string[]>();
for (const e of entries) byIdx.set(e.idx, [...(byIdx.get(e.idx) ?? []), e.tag]);
for (const [idx, tags] of byIdx) {
  if (tags.length > 1) note(`idx ${idx} DIPAKAI ${tags.length}×: ${tags.join(", ")} — dua branch menomori sendiri-sendiri.`);
}
entries.forEach((e, i) => {
  if (e.idx !== i) note(`idx melompat: entri ke-${i} bertag '${e.tag}' ber-idx ${e.idx}.`);
});

// 3. journal ↔ files, both directions.
const sqlFiles = readdirSync(drizzleDir).filter((f) => f.endsWith(".sql"));
const named = new Set(entries.map((e) => `${e.tag}.sql`));
for (const e of entries) {
  if (!existsSync(join(drizzleDir, `${e.tag}.sql`))) note(`journal menyebut '${e.tag}' tapi berkas .sql-nya TIDAK ADA.`);
}
for (const f of sqlFiles) {
  if (!named.has(f)) note(`berkas '${f}' ada tapi TIDAK disebut journal — ia tidak akan pernah dijalankan.`);
}

// 4. optional: is our newest stamp above what the target database already recorded?
if (process.argv.includes("--db")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    note("--db diminta tapi DATABASE_URL kosong.");
  } else {
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { max: 1 });
    try {
      const rows = await sql<{ max: string | null }[]>`
        select max(created_at)::text as max from drizzle.__drizzle_migrations
      `;
      const dbMax = Number(rows[0]?.max ?? 0);
      const mine = entries.at(-1)!;
      console.log(`Database  : stempel tertinggi ${dbMax}`);
      console.log(`Journal   : ${mine.tag} = ${mine.when}\n`);
      if (mine.when <= dbMax) {
        note(
          `'${mine.tag}' (${mine.when}) TIDAK di atas stempel database (${dbMax}).\n` +
            `    Deploy berikutnya akan MELEWATINYA dan tetap melapor "applied successfully".`,
        );
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} masalah:\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error(
    `\nCatatan: bandingkan dengan origin/main SEBELUM membuat migrasi baru —\n` +
      `branch lain mungkin sudah memakai nomor berikutnya.`,
  );
  process.exit(1);
}

console.log("✓ Journal waras: stempel naik, idx unik & berurutan, journal ↔ berkas cocok.");
