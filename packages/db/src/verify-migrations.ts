import { isMillisecondStamp } from "./migration-stamp";
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
 * 4. **A tag that an EARLIER revision of the journal recorded and today's does not.** Checks 1–3 read
 *    the journal against itself and the files beside it, so they are structurally blind to an entry
 *    that was removed or renumbered — the journal that lost it is perfectly self-consistent. Two
 *    entries went that way before anyone noticed: `0046_good_dust`, whose `.sql` was never committed
 *    (it broke `migrate` outright, so production never created `kelurahan` and `/api/public/ongkir`
 *    500'd on every checkout), and `0064_store_public_email`, renumbered to `0070` after a two-branch
 *    collision. This check replays every revision of `_journal.json` in THIS history and fails on a
 *    tag that has quietly gone missing. A deliberate removal is declared in `RETIRED` below, with the
 *    reason — the point is that no one can drop an entry without writing down why.
 *
 * With `--db` it also answers the questions no offline check can:
 *   • **Is my newest stamp above the one the TARGET database already holds?** Point `DATABASE_URL` at
 *     production and it tells you whether the next deploy will run your migration or quietly skip it.
 *   • **Does every applied row correspond to a file this branch still has?** (check 5) — the one that
 *     catches DDL nobody can reproduce from git. The shared dev container carries `color_palettes`
 *     from an unmerged branch and `orders.ship_kelurahan_*` from a migration lost to a `0049`
 *     collision, and every offline check is green on both.
 *
 * ⚠️ **What a local verifier cannot know.** It compares a database against ONE checkout. A row it
 * cannot explain may be an unmerged branch, a `drizzle-kit push`, or a hand-run `psql` — it can say
 * "this branch cannot reproduce this", never "this is wrong". And drizzle keys on `created_at`, not
 * on the hash, so an edited-after-applying file is reported and will still never be re-run.
 *
 * Exits non-zero on any failure, so it can gate a release.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tags an earlier revision of the journal recorded and today's deliberately does not.
 * Adding a name here is the act of writing down WHY an entry disappeared. Never add one to silence
 * the check — if you cannot say what happened to it, the check is telling you the truth.
 */
const RETIRED: Record<string, string> = {
  "0046_good_dust":
    "journal entry whose .sql was never committed — `migrate` aborted on it, so production never " +
    "created `kelurahan`. Replaced by 0046_silky_king_cobra (f1f417d), which ships the file.",
  "0064_store_public_email":
    "renumbered to 0070_store_public_email after feat/cetak-resi-demo landed its own 0064–0069 " +
    "while this entry was open. Same SQL, higher stamp.",
  "0088_platform_password_revokes_sessions":
    "renumbered to 0089 after ka/flow-audit landed its own 0088_ka_shipment_payment while this " +
    "entry was open. Same SQL. ⚠️ THE RENUMBER WAS THE EASY HALF — this entry was stamped " +
    "1785774400000, deliberately HIGH because the shared dev DB already carried that branch's " +
    "then-unmerged migration; once it landed, main's newest stamp became 1785895548092, i.e. " +
    "ABOVE ours. Drizzle applies only entries past the target's newest stamp, so keeping the old " +
    "number's stamp would have left this migration SKIPPED on production while printing " +
    "'migrations applied successfully' — and with no platform_admins.password_changed_at column, " +
    "getPlatformSession throws and every operator is locked out of the control plane. Re-stamped " +
    "to 1785895600000. RENUMBER AND RE-STAMP ARE TWO SEPARATE OBLIGATIONS; this check catches the " +
    "first, and nothing catches the second but reading max(created_at) on the target.",
};

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

// 1b. `when` must be a MILLISECOND stamp, not merely "bigger than the last one".
//
// Measured 2026-08-19, on this very script's watch: `0096` was first written with a stamp of
// **1787135109197478972** — `date +%s%3N` handed back NANOseconds. Check 1 above passed it happily,
// because 1.79e18 does increase. What that stamp would have cost is the hazard AGENTS.md already
// names: drizzle applies only entries whose `when` exceeds the newest stamp recorded in the target
// database, so once a nanosecond stamp lands, EVERY later migration written with an ordinary
// millisecond stamp is silently skipped — with "migrations applied successfully" printed over it.
// The wrong scale is invisible to a monotonicity check by construction; it needs its own claim.
//
// The window is deliberately generous rather than clever: any 13-digit ms value from 2001-09-09
// (1e12) up to the year 5138 (1e14) passes, so nobody has to touch this when the clock moves. A
// stamp in SECONDS (10 digits) or NANOseconds (19) is what this is here to refuse.
// Predikatnya hidup di `migration-stamp.ts` — modul murni, supaya bisa diuji tanpa menjalankan
// skrip ini beserta seluruh I/O-nya. Test-nya membuktikan merah terhadap stempel nanodetik yang
// benar-benar pernah ditulis di sini.
for (const e of entries) {
  if (!isMillisecondStamp(e.when)) {
    note(
      `stempel BUKAN milidetik: ${e.tag} = ${e.when} (${String(e.when).length} digit).\n` +
        `    Sebuah stempel yang terlalu besar membuat SETIAP migrasi berikutnya dilewati diam-diam.\n` +
        `    Perbaiki menjadi milidetik 13-digit (mis. Date.now()), jangan detik dan jangan nanodetik.`,
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

// 4. TAG-SET REGRESSION — replay every past revision of the journal in THIS history.
//
// Scoped to HEAD's ancestry on purpose: a sibling branch that was never merged has not "lost"
// anything, and folding `--all` in here would fail forever on every open PR's own numbering.
// The cost is honest and worth stating — a tag that only ever existed on a branch that never
// reached this history is invisible here. `0049_shipping_kelurahan` is exactly that case, and the
// thing that catches it is check 5 against a database that has it applied.
try {
  // Both the `git log` pathspec and `git show <rev>:<path>` are resolved from the REPO ROOT here —
  // a path relative to wherever this script happens to run silently matches nothing.
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: drizzleDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const git = (args: string[], maxBuffer = 1024 * 1024) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer, stdio: ["ignore", "pipe", "ignore"] });
  const journalRel = relative(root, journalPath).split("\\").join("/");
  const revs = git(["log", "--format=%H", "HEAD", "--", journalRel]).split("\n").filter(Boolean);

  const everRecorded = new Map<string, string>(); // tag → the OLDEST commit that recorded it
  for (const rev of revs) {
    let blob: string;
    try {
      blob = git(["show", `${rev}:${journalRel}`], 32 * 1024 * 1024);
    } catch {
      continue; // the path did not exist at that revision (a rename) — nothing to read
    }
    try {
      for (const e of JSON.parse(blob).entries as Entry[]) everRecorded.set(e.tag, rev);
    } catch {
      continue; // a revision mid-merge-conflict is not evidence of anything
    }
  }

  const today = new Set(entries.map((e) => e.tag));
  const vanished = [...everRecorded.keys()].filter((t) => !today.has(t));
  const unexplained = vanished.filter((t) => !(t in RETIRED));
  console.log(
    `Riwayat   : ${revs.length} revisi journal, ${everRecorded.size} tag pernah tercatat, ` +
      `${today.size} hari ini (${vanished.length} hilang, ${vanished.length - unexplained.length} sudah dijelaskan)\n`,
  );
  for (const t of unexplained) {
    note(
      `tag '${t}' PERNAH tercatat di journal (${everRecorded.get(t)!.slice(0, 8)}) tapi HILANG sekarang.\n` +
        `    Journal-nya konsisten dengan dirinya sendiri, jadi cek 1–3 tidak bisa melihat ini.\n` +
        `    Kalau memang sengaja dibuang/dinomori-ulang, tulis alasannya di RETIRED (src/verify-migrations.ts).`,
    );
  }
  // A RETIRED name that is back in the journal is a stale explanation, not a failure — say so once.
  for (const t of Object.keys(RETIRED)) {
    if (today.has(t)) console.log(`ℹ '${t}' ada lagi di journal — hapus entri RETIRED-nya.`);
  }
} catch {
  console.log("ℹ Riwayat journal dilewati (git tidak tersedia di sini).\n");
}

// 5. optional: reconcile against a live database.
if (process.argv.includes("--db")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    note("--db diminta tapi DATABASE_URL kosong.");
  } else {
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { max: 1 });
    try {
      // drizzle hashes the WHOLE .sql file with sha256 (drizzle-orm/migrator readMigrationFiles),
      // so the applied rows can be matched back to files by content — not by name, which is
      // precisely the thing a collision changes.
      const byHash = new Map<string, Entry>();
      for (const e of entries) {
        byHash.set(createHash("sha256").update(readFileSync(join(drizzleDir, `${e.tag}.sql`), "utf8")).digest("hex"), e);
      }
      const applied = await sql<{ hash: string; created_at: string }[]>`
        select hash, created_at::text as created_at
          from drizzle.__drizzle_migrations
         order by created_at
      `;
      const dbMax = applied.length ? Number(applied.at(-1)!.created_at) : 0;
      const mine = entries.at(-1)!;
      console.log(`Database  : ${applied.length} baris terpakai, stempel tertinggi ${dbMax}`);
      console.log(`Journal   : ${entries.length} entri, ${mine.tag} = ${mine.when}\n`);

      const explained = new Set<string>();
      const orphans: { hash: string; when: number }[] = [];
      const drifted: string[] = [];
      for (const row of applied) {
        const e = byHash.get(row.hash);
        if (!e) {
          orphans.push({ hash: row.hash, when: Number(row.created_at) });
          continue;
        }
        explained.add(e.tag);
        if (e.when !== Number(row.created_at)) {
          note(
            `'${e.tag}' terpakai dengan stempel ${row.created_at}, journal bilang ${e.when} — ` +
              `entri ini pernah dinomori/distempel ulang.`,
          );
        }
      }
      // A journal entry whose hash is nowhere in the table is EITHER never applied, OR applied and
      // then edited. drizzle keys on created_at, so an edited file will never be re-run: the
      // database is running SQL this branch no longer contains, silently, forever.
      const stamps = new Set(applied.map((r) => Number(r.created_at)));
      for (const e of entries) {
        if (explained.has(e.tag)) continue;
        if (stamps.has(e.when)) drifted.push(e.tag);
        else if (e.when <= dbMax)
          note(
            `'${e.tag}' (${e.when}) di BAWAH stempel tertinggi database (${dbMax}) dan TIDAK terpakai.\n` +
              `    drizzle tidak akan pernah menjalankannya di sini.`,
          );
      }
      const byWhen = new Map(entries.map((e) => [e.when, e.tag]));
      for (const t of drifted) {
        note(
          `berkas '${t}.sql' BERUBAH setelah dijalankan (stempelnya terpakai, isinya tidak cocok).\n` +
            `    drizzle mengunci pada created_at, jadi versi baru TIDAK akan pernah dijalankan di database ini.`,
        );
      }
      // A row whose stamp belongs to a drifted entry is that SAME entry, seen from the other side —
      // reporting it twice makes ten problems out of eight and buries the ones that are new.
      for (const o of orphans.filter((o) => !drifted.includes(byWhen.get(o.when) ?? ""))) {
        note(
          `database menjalankan migrasi ${o.hash.slice(0, 12)}… (stempel ${o.when}) yang TIDAK cocok ` +
            `dengan berkas mana pun di branch ini.\n` +
            `    DDL yang tidak bisa direproduksi dari git: branch lain, 'drizzle-kit push', atau psql manual.\n` +
            `    Cari isinya: git cat-file --batch-all-objects | sha256 — atau bandingkan dengan produksi.`,
        );
      }
      // The stamp question, asked only when it can still bite: an entry that is ALREADY applied here
      // is not going to be skipped by the next deploy — complaining about it is the alarm that is
      // always on, which is the alarm that is off.
      if (mine.when <= dbMax && !explained.has(mine.tag) && !drifted.includes(mine.tag)) {
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

console.log(
  "✓ Journal waras: stempel naik, idx unik & berurutan, journal ↔ berkas cocok, tidak ada tag yang hilang.",
);
