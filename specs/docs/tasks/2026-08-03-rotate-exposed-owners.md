# Rotating the accounts whose password is still `tokophi123` — a procedure, NOT a change

**Date:** 2026-08-03 · **Status:** 🔴 **WRITTEN, NOT EXECUTED. Nothing was rotated.**
**Measured against production** (read-only) on 2026-08-03. Closes the measurement half of
[`NEXT.md` N15](./NEXT.md) and of `2026-08-01-audit-wave-2.md` ②.
**Nobody may run this without the owner's say-so** — a rotation locks a merchant out until a human
reaches them, and this product has no mailer.

---

## ① What was actually measured, and the headline

> ### 🔵 **The `createStore` exposure has ZERO instances on production.**
> Eight stores, and **not one of them was created through super-admin `createStore`.** Seven are the
> seed's own demo stores; the eighth registered itself through `provisionStore` and chose its own
> password. The code fix in `2399ea5` was correct and worth shipping — it just has no backlog to
> repair. **The 8 accounts that DO verify against `tokophi123` are all seeded identities**, and that
> is a different defect with a different owner: **N15**, the login pages and the seed.

| | count |
|---|---|
| stores on production | **8** |
| stores whose **owner** could not be resolved | **0** — every store has exactly one `store_users` row with `role='owner'`, and every one of them joins to a live `users` row with a parseable hash |
| store owners whose password verifies against `tokophi123` | **7 of 8** |
| …of those, provisioned by super-admin `createStore` | **0** |
| non-owner store users (`admin` / `staf` / `gudang`) | **0 rows exist at all**, so `addStoreUser` has never run here |
| platform operators in `platform_admins` | **1**, and it **is** affected (`admin@tokophi.id`) |
| `customers` rows carrying a `password_hash` | **0 of 32** — the storefront shopper accounts are unaffected |

### The per-store breakdown

| store slug | owner email | store created | **user row created** | provisioning path | verifies `tokophi123` |
|---|---|---|---|---|---|
| `gadget-murah-id` | bayu@gadgetmurah.id | 2025-12-04 | 2026-07-10 16:04:31 | **seed** (`DEMO_STORES`) | 🔴 **yes** |
| `batik-nusantara` | ongki@batiknusantara.id | 2025-12-28 | 2026-07-10 16:04:30 | **seed** (`STORE`) | 🔴 **yes** |
| `tas-rajut-handmade` | sinta@tasrajut.id | 2026-01-23 | 2026-07-10 16:04:31 | **seed** (`DEMO_STORES`) | 🔴 **yes** |
| `sepatu-lokal-project` | dimas@sepatulokal.id | 2026-02-12 | 2026-07-10 16:04:31 | **seed** (`DEMO_STORES`) | 🔴 **yes** |
| `kopi-senja` | rangga@kopisenja.id | 2026-03-29 | 2026-07-10 16:04:31 | **seed** (`DEMO_STORES`) | 🔴 **yes** |
| `hijab-amara` | amara@hijabamara.id | 2026-04-23 | 2026-07-10 16:04:31 | **seed** (`DEMO_STORES`) | 🔴 **yes** |
| `snack-rumahan-bu-tati` | tati@snackrumahan.id | 2026-06-26 | 2026-07-10 16:04:31 | **seed** (`DEMO_STORES`) | 🔴 **yes** |
| `toko-tes` | yugoartono2@gmail.com | 2026-07-14 | 2026-07-14 03:53:12 | **self-serve `provisionStore`** | ✅ no |
| *(control plane)* `platform_admins` | admin@tokophi.id | — | 2026-07-10 16:04:31 | **seed** | 🔴 **yes** |

⚠️ **`stores.created_at` is NOT when the row was written.** The seed back-dates it (`daysAgo(d.createdDaysAgo)`)
so the platform's charts have a lifecycle to draw. The column that says when the account really came
into existence is `users.created_at`, and **all seven seeded owners share one 1,4-second window on
2026-07-10** — one seed run. Reading the first column alone would report seven stores "provisioned"
across eight months.

**How each path was attributed** — evidence, not inference:

- **seed** — `users.created_at` inside that one window, **and** `store_users.accepted_at` equal to the
  frozen anchor date the seed computes from `DEMO_STORES[].createdDaysAgo` (midnight UTC, to the
  second), **and** the owner's email/name matching the literal in `packages/db/src/seed.ts:81-94`.
  `createStore` cannot produce these: it stamps `acceptedAt: new Date()` from the real clock.
- **self-serve** — `platform_activity` holds `kind='signup'`, text `Toko baru "Toko Tes" mendaftar
  (yugoartono2@gmail.com)`, which is the literal template in `apps/admin/lib/provision.ts:133`, with
  a `ts` equal to the `users.created_at` to the millisecond.
- **`createStore`** — its own audit line is `Toko dibuat oleh platform: …` (`actions.ts` → `logStore`).
  **That string does not appear once in the 11 `platform_activity` rows on production.**

### The method, exactly

`users.password_hash` is `salt:hash` where `hash = scryptSync(pw, salt, 64)` with **Node's default
scrypt parameters** (N=16384, r=8, p=1) — read from `packages/lib/src/password.ts:45-48` and
`apps/admin/lib/auth.ts:17-30`, which are byte-identical schemes. Postgres has **no scrypt**, so the
check cannot be done in SQL; the hashes were streamed over SSH straight into `node`'s stdin, verified
in memory with the same `timingSafeEqual` comparison `verifyPassword` uses, and **only the boolean was
printed**. No hash was written to disk and none appears in this document.

```bash
# READ-ONLY. Prints email + slug + a verdict. Never prints hash material.
ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 \
  'docker exec -i $(docker ps --format "{{.Names}}" | grep -m1 "^postgres-l7r4qaqcml4zigw1dc7iptun-") \
     psql -U tokophi -d tokophi -At -F "|" -P pager=off' <<'SQL' | node -e '
const { scryptSync, timingSafeEqual } = require("node:crypto");
const PW = "tokophi123";                       // the string to test against
const verify = (stored) => {
  if (!stored) return null;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return null;             // unparseable → reported, never dropped
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(PW, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
let buf = ""; process.stdin.on("data", d => buf += d);
process.stdin.on("end", () => {
  let n = 0, hit = 0;
  for (const line of buf.trim().split("\n")) {
    if (!line) continue;
    const parts = line.split("|"); const stored = parts.pop();
    const v = verify(stored); n++; if (v === true) hit++;
    console.log(parts.join(" | "), "->", v === null ? "NO_HASH" : v ? "*** VERIFIES ***" : "no");
  }
  console.log(`\nTOTAL rows=${n}  affected=${hit}`);   // the number that must reach 0
});
'
select 'store_owner', s.slug, u.email, su.role, u.password_hash
  from stores s
  join store_users su on su.store_id = s.id and su.role = 'owner'
  join users u on u.id = su.user_id
 order by s.created_at;
select 'store_user_nonowner', s.slug, u.email, su.role, u.password_hash
  from stores s
  join store_users su on su.store_id = s.id and su.role <> 'owner'
  join users u on u.id = su.user_id;
select 'user_no_membership', '-', u.email, '-', u.password_hash
  from users u where not exists (select 1 from store_users su where su.user_id = u.id);
select 'platform_admin', '-', pa.email, pa.role::text, pa.password_hash from platform_admins pa;
SQL
```

⚠️ **The `user_no_membership` arm is not decoration.** A `users` row with no `store_users` row belongs
to no store and would silently fall out of any query joined through `store_users` — the denominator
would look clean while the row still logs in nowhere and sits there. On production it returns **0 rows**
(8 users, 8 owner memberships), so the count is complete: **9 password-bearing principals examined, 8
affected.**

⚠️ Resolve the container **by prefix**. The hash suffix changes on every deploy.

---

## ② Is `resetOwnerPassword` usable for this? — **Yes for the stores. No for the operator.**

Checked against the code at `52ef1de`, not assumed:

| | store owners | `admin@tokophi.id` |
|---|---|---|
| an action exists | ✅ `resetOwnerPassword(storeId)` — `actions.ts:518` | 🔴 **none.** `invitePlatformAdmin` is the **only** write to `platform_admins` in the whole app: one `INSERT`, no `UPDATE`, no `DELETE` |
| rank required | `requirePlatformAdmin("owner")` — the single operator holds `owner`, so the gate passes | — |
| resolves the target | joins `store_users` on `role='owner'`; **all 8 stores have exactly one**, so no store is unreachable | — |
| reveals the new password | ✅ a **Dialog** (`store-detail.tsx:445`) with a **Salin** button — it stays open until dismissed | — |
| audited | ✅ `logStore(storeId, "Password owner (…) direset oleh platform")` | — |

**So: use the UI for the seven stores.** `rich.tokophi.com` → **Toko** → the store → the right-hand
panel → **"Reset password owner"** → the credential dialog opens → **press Salin**, paste it somewhere
safe **before closing the dialog**, then hand it over.

> 🔴 **The dialog is the only copy that will ever exist.** `tempPassword()` returns a string that is
> hashed and discarded; nothing writes it to a table, a log or a file, and the audit row records only
> *that* a reset happened. **Closing that dialog without copying locks the merchant out until someone
> resets them again** — and a second reset invalidates the first, so a half-remembered string is worth
> nothing. This is the single point of failure in the whole procedure. Have the destination (the chat
> window, the note) open **before** you click.

### The operator account needs raw SQL — and it is the one that can lock YOU out

There is one platform admin. There is no self-service password change on the control plane, no reset
action, and no mailer. **A botched `UPDATE` on that row ends super-admin access to the platform
outright** — you would be repairing it from this same psql prompt with no UI to check against.

**Do not `UPDATE` it first. Mint a second operator through the code path that already works, prove you
can log in as it, and only then touch the seeded one:**

1. `rich.tokophi.com` → **Pengaturan** → invite a new operator with role **`owner`**.
   `invitePlatformAdmin` mints a real `tempPassword()` and reveals it once (persistent toast) — same
   copy-it-now rule as above.
2. **Log out. Log in as the new operator.** Do not proceed until that succeeds.
3. Now rotate or remove `admin@tokophi.id` (SQL below). If it goes wrong, the new account is still
   good and you have a way back in.

---

## ③ Raw SQL — when you need it, and how to make it verifiable

Needed for exactly two things: `platform_admins`, and any bulk pass over the seven store owners you do
not want to click through one at a time.

**Postgres cannot compute this hash.** There is no scrypt in Postgres and none of `pgcrypto`'s digests
matches the stored format. The hash must be minted by Node, with **the repo's own helper** — never a
hand-rolled `scrypt` call, because the parameters are what `verifyPassword` will re-derive:

```bash
# In the repo (any worktree). Prints TWO lines: the password to hand over, then the hash to store.
cd <repo>
npx tsx -e 'import { tempPassword, hashPassword } from "@tokophi/lib/password";
const pw = tempPassword();
console.log("PASSWORD (hand this over, once):", pw);
console.log("HASH (paste into the UPDATE):", hashPassword(pw));'
```

⚠️ **That output is credential material.** Do not redirect it to a file, do not paste it into a commit,
a PR, a doc or a ticket. If it lands in a scratch file, delete the file.

Then, one transaction, with the verification **inside it** so a wrong `WHERE` is visible before you
commit:

```sql
BEGIN;

-- ONE row. Name the email; never rotate by a LIKE or by a role.
UPDATE platform_admins
   SET password_hash = '<paste the HASH line here>'
 WHERE email = 'admin@tokophi.id';
-- Expect: UPDATE 1.  Anything else -> ROLLBACK and work out why.

-- Verify the blast radius before committing: exactly one row, and it is the one you meant.
SELECT email, role, left(password_hash, 8) || '…' AS changed
  FROM platform_admins
 WHERE email = 'admin@tokophi.id';

COMMIT;   -- or ROLLBACK;
```

The same shape for a store owner, keyed through the membership so a typo cannot reach another store's
row:

```sql
BEGIN;
UPDATE users u
   SET password_hash = '<hash>'
  FROM store_users su, stores s
 WHERE su.user_id = u.id AND su.role = 'owner'
   AND s.id = su.store_id AND s.slug = 'kopi-senja';
-- Expect: UPDATE 1.
COMMIT;
```

**One password per account.** Do not reuse one minted string across the seven — that recreates exactly
the defect being repaired, with a fresher constant.

⚠️ **A rotation does NOT end an existing session.** `getSession()` re-checks *membership* against the
database, not the password and not a token version (`apps/admin/lib/auth.ts:57-100`), so anyone already
holding a valid `session` cookie keeps full access for up to its remaining 7 days. Rotating locks out a
future login; it does not evict a present one. The only kill switch is deleting the `store_users` row
(`NEXT.md` N1, still open). **If the concern is an active intruder rather than a latent exposure, a
password rotation alone does not answer it.**

---

## ④ How the merchant learns the new password — the honest answer

**There is no mailer in this product.** Not "unconfigured" — none exists: no SMTP settings, no mail
package, no send call anywhere. `AGENTS.md` says so, and it is the stated reason cart recovery travels
on WhatsApp. The one thing named "reminder" in super-admin, `sendPaymentReminder`, writes an audit
line and its own toast admits it: *"Pengingat dicatat di log aktivitas (belum ada pengiriman
otomatis)."*

So the channel is: **an operator opens WhatsApp and types a message.** There is no other. Any plan that
assumes the merchant will "get an email" is planning a lockout.

**What that means for these nine accounts specifically:**

- **The seven store owners are fabricated identities.** `rangga@kopisenja.id`, `amara@hijabamara.id`
  and the rest are literals in `packages/db/src/seed.ts`; the domains are not real and nobody reads
  that mail. **There is no human to notify, and therefore no lockout to schedule.** Rotating them is
  free of human cost — which is exactly why it is not urgent either: an attacker logging in as
  `tati@snackrumahan.id` reaches a store with **0 orders, 0 customers and 0 products**.
- **`batik-nusantara` is the exception and it is not a merchant problem, it is a demo problem.** It
  holds the only real data on the platform (60 orders, 32 customers, 25 products) and it is the login
  that `AGENTS.md`, `CLAUDE.md` and `apps/admin/app/login/login-form.tsx:48` all name in writing.
  Rotating it breaks the demo and falsifies four documents in the same instant. **Do not rotate it as
  part of a security pass — it belongs to the N15 decision** (delete the hint vs rotate the seed),
  which is the owner's.
- **`admin@tokophi.id` is the one that matters.** It is a *working control-plane credential* whose
  password is published in this repository and printed on the login screen it unlocks
  (`apps/super-admin/app/login/page.tsx:30`), and the control plane reaches every tenant — including
  `toko-tes`, the one real merchant, via impersonation. **The operator is the person reading this
  document, so the notification problem does not exist for it.** It is both the highest-value account
  and the cheapest to rotate.

---

## ⑤ Ordering — and what each order costs

Rotating before you can reach someone locks them out; reaching someone before you rotate widens the
window. With the population measured above the trade is unusually kind, because only one account has a
human behind it and that human is you.

1. **`admin@tokophi.id` — FIRST, and it is the only genuinely urgent step.** Via §② (invite a second
   `owner` operator → verify login → then rotate or delete the seeded row). No notification needed.
   **Cost of delaying: the whole platform.** ⚠️ Rotating it does **not** remove the credential from the
   login page — see §⑦.
2. **The six inert seeded stores** (`gadget-murah-id`, `tas-rajut-handmade`, `sepatu-lokal-project`,
   `kopi-senja`, `hijab-amara`, `snack-rumahan-bu-tati`) — any time after ①, in any order, via the UI
   in §②. Nobody is locked out because nobody is logged in. **Cost of delaying: near zero** — between
   them they hold 15 orders and no customer records. **Cost of doing it: also near zero**, which is why
   it is worth doing simply to make the verification in §⑥ return a clean 0.
3. **`batik-nusantara` — LAST, and only with an explicit decision.** See §④. If it is rotated, the
   demo credential in both login pages and in the docs must change in the same working session or the
   next person to open the app hits a password that no longer works and has no way to ask.
4. **`toko-tes` — do not touch it.** It is not affected, its owner chose their own password, and
   resetting it would lock out the one real user on the platform to fix a problem they do not have.
   ⚠️ **This is the one mistake this document exists to prevent**: a "rotate every store owner" script
   would sweep it up. **Rotate the accounts that were measured, never the table.**

---

## ⑥ Verification — the same query, and the number is zero

Re-run §① **verbatim**, unchanged. It is the same instrument in both directions, which is the point.

```
TOTAL rows=9  affected=0
```

`affected` is the only figure that matters, and `rows` must still be **9** — a smaller denominator
means an account stopped being counted rather than stopped being exposed. Read the per-line output too:
a `NO_HASH` where a hash used to be means the `UPDATE` wrote something unparseable and **that account
can no longer log in at all** (`verifyPassword` returns `false` on a missing `:`), which is a lockout
wearing the costume of a fix.

Then confirm the rotation is real and not merely different — log in once, as the account you rotated,
with the string you handed over.

⚠️ **The seed will not undo this.** `packages/db/src/seed.ts:684` bails when `stores` is non-empty
unless `SEED_FORCE=1`, so the redeploy that runs on every merge leaves rotated hashes alone. **`SEED_FORCE=1`
against production would restore every one of them** — along with truncating the platform. It must
never be set there.

---

## ⑦ What this does NOT fix

- 🔴 **Both login pages still print a credential.** `apps/super-admin/app/login/page.tsx:30` renders
  *"Dev: admin@tokophi.id / tokophi123"* and even pre-fills the email field;
  `apps/admin/app/login/login-form.tsx:48` renders *"Dev: ongki@batiknusantara.id / tokophi123"*.
  **Rotating the accounts does not delete the hints — it only makes them false.** That is an
  improvement over a working advertised credential and it is not the fix. **N15, owner's call.**
- 🔴 **The seeded demo accounts are a separate decision from this rotation.** `ongki@batiknusantara.id`
  and `admin@tokophi.id` exist *because* the seed creates them on a fresh deploy. Rotating the rows on
  production changes nothing in `seed.ts`: the next environment seeded from scratch gets `tokophi123`
  again, on both. Changing that means changing the seed — and **the seed is not a migration**, so it
  reaches new deployments only, which is the whole reason this document exists.
- **`createStore` is fixed and it stays fixed** (`2399ea5` + `no-fixed-password.test.ts`). Nothing here
  is a code change and none is needed.
- **Sessions are not revoked** (§③). **Impersonation is not revoked either** — `NEXT.md` N1.
- **The `customers` table was checked and is clean** (0 of 32 carry a hash), but `seed.ts:887` *does*
  hash `tokophi123` into registered customers. A future `SEED_FORCE` run, or a fresh environment,
  creates shopper logins on the same string.
- **Whether the exposure was ever used.** There is **no failed-login record anywhere** — no table, no
  audit row, no log line (`NEXT.md` N18b ③) — so "has anyone logged in as one of these?" is
  unanswerable from the data. Do not report it as "no evidence of compromise"; report it as **not
  observable**.

---

## Appendix — the flip side of the same measurement

The instrument in §① takes the string to test as a one-line constant (`const PW = "tokophi123"`). It is
worth keeping for its own sake: after any future incident, changing that one line answers "does any
account on this platform still use <string>?" in one read-only command that prints no credential
material. That is the reusable part of this task — the rotation is a one-off; the query is not.
