# Order lifecycle — COD, the ledger, and the one legal set of transitions

> Moved **verbatim** from `AGENTS.md` on 2026-10-28 (Claude Code warns when `AGENTS.md` exceeds 150k chars, and it is
> loaded in full into every session). `AGENTS.md` keeps a short digest of the rules plus a pointer here; this file keeps
> the reasoning and the incident history. Words like "above"/"below"/"the next section" refer to the old single-file
> layout — follow the named file or section instead. **If this file and the code disagree, the code wins — fix this file.**


> ### 📦 THE RULE: **COD is a FACT ABOUT THE ORDER (`payments.method`), never a parameter.**
> `createShipment` derives it and REFUSES a caller that disagrees. `input.cod` is a claim we check,
> not an instruction we obey. It used to be `input.cod ? total : 0`, and both callers were wrong in
> opposite directions: the bulk loop passed `!!rate.cod` — the SERVICE's capability, true for every
> order on an SPX service in a COD-enabled store — over a queue that deliberately holds PREPAID
> orders (measured: 75 orders, 8 COD, **67 already paid**), so one click told the courier to collect
> cash again from 67 buyers; and the order detail's checkbox defaulted to `false` and was never
> seeded, so a real COD parcel was booked collecting **0** and the merchant was then credited the
> full sale as WITHDRAWABLE for cash nobody took.

- **`orders.status` has ONE writer: `applyOrderStatusChange`.** Both shipping status writes go through
  it (there is no raw `set({ status })` left in `shipping.ts`). It holds three guards, and all three
  are load-bearing: same-status is a no-op, `batal`/`retur` are terminal, and an explicit `ALLOWED`
  table names the only legal moves. The table exists because the first two permit everything they do
  not refuse — which allowed `selesai → batal` (restores stock **and** claws back an `available` sale
  on a delivered COD order whose cash is in hand) and `selesai → dikirim` (un-completes a settled
  order). `setOrderStatus` is a server action taking `status` straight from the client, so the UI
  hiding a button is not the boundary. `selesai → retur` stays legal: a delivered parcel can still
  come back, and that path reverses the sale correctly.
- **`creditSaleForPayment` excludes `batal` AND `retur`.** Dropping `retur` is how a payment landing
  after a return credited the full sale as immediately withdrawable: the claw-back had already run
  and found nothing to reverse, the order is terminal so nothing re-runs it, and `pay/callback`
  transitions on "status differs" — so a `gagal` payment on a still-live VA can reach `berhasil` long
  after the return. Stock restored **and** the merchant keeps the money.
- **A double-credit is a DB impossibility, not a code convention** — three partial unique indexes
  (`ledger_one_sale_per_payment`, `ledger_one_sale_per_order`, `ledger_one_retur_per_order`) plus
  `on conflict do nothing` on every writer. The balance is DERIVED (`Σ amount_idr` by status); there
  is no stored-balance column and there must not be.
- **⚠️ NOTHING THAT SUMS THE BALANCE MAY JOIN `orders`, and a `payout` entry is why.** Its `order_id`
  is NULL by design — it belongs to a withdrawal, not an order — so an inner join silently drops every
  payout and the available balance jumps by everything already paid out (measured on production:
  Rp21.043.271 → **Rp43.733.271**, handing back Rp23,5jt). By the same token `not exists (select 1 from
  orders where id = l.order_id)` is TRUE for a NULL, so the obvious orphan query reports every
  withdrawal as corruption. **Count `order_id IS NULL` separately, always.**
- **`npm run verify-ledger -w @tokophi/db`** (**safe against production — but NOT read-only, see below**) reports children of
  `orders` with a missing parent and what they are worth in each store's balance. It exists because
  production carried **48 such rows** — 10 `payments`, 30 `order_line_items`, 8 `ledger_entries`, all
  from ten `INV-47xx` orders that no longer exist — putting **Rp810.000 into `available`**, i.e.
  withdrawable via `requestPayout`, and Rp2.302.000 into `pending`, where `/saldo` printed a held total
  its own itemised list (`getPendingFunds`, which *does* join `orders`) could not account for.
  The three FKs are present and VALIDATED and Postgres refuses a dangling insert today, so **no
  application path can make these**; only a load with referential triggers off (`pg_restore
  --data-only --disable-triggers`, `session_replication_role = 'replica'`). Cleanup SQL —
  transactional, guarded, ending in `rollback` — is `ops/tokophi-orphan-cleanup.sql`; it is
  deliberately **not** a drizzle migration, because merging one would delete production rows
  unattended on the next Coolify build. Both traps are pinned by `packages/db/src/verify-ledger.test.ts`.
  ⚠️ **"Read-only" was WRONG, and the word matters.** `refusesDanglingInsert` INSERTs an account, a
  store and a deliberately-dangling `ledger_entries` row — deliberately, because `convalidated` only
  says the constraint was checked ONCE and the question is whether the trigger fires TODAY (that gap
  is exactly what a `--disable-triggers` restore leaves behind). Both exit paths throw (`23503`, or an
  explicit "THE FOREIGN KEY DID NOT FIRE"), so `sql.begin()` always rolls back and nothing commits —
  it is genuinely safe. But it opens a WRITE transaction, and an audit of "what touches production"
  that trusted the old phrase would have filtered it straight out.
  ✅ **Run against PRODUCTION 2026-08-05** — the first time since the cleanup. All **7** child tables
  0 orphans, every FK VALIDATED, the dangling insert refused today, `available` **Rp21.032.562** and
  `pending` **Rp23.424.347** both fully backed by orders. The 48 orphan rows are gone.
  **The rollback was CONFIRMED, not assumed**: `select count(*) from stores where slug like
  'fk-probe-%'` afterwards → **0**.
  ⚠️ Run it where the credential already lives, so it never lands in a shell history or a transcript —
  the admin container carries both `DATABASE_URL` and the monorepo source:
  `docker exec -w /app/packages/db $(docker ps --format '{{.Names}}' | grep -m1 '^admin-') /app/node_modules/.bin/tsx src/verify-ledger.ts`
- **A GUESS MUST NEVER SUCCEED QUIETLY, and "we flag it" is a claim to grep before trusting.** The
  comment above `createShipment`'s destination fallback said the guess "is flagged as a guess" while
  `destinationGuessed` existed **nowhere in the repo** — 77 orders carry no `ship_district_id`, so the
  branch was live and silent. It now returns the district it actually MATCHED (not the city it
  searched: "Surabaya" → "Bandar Surabaya, Lampung Tengah, LAMPUNG" is only visible if you print the
  match), the detail screen warns for 20s, and `BulkResult.guessedDestination` carries one entry per
  order — a bulk run is exactly where three guesses vanish behind "50 pesanan dibooking".
- **Report what you WROTE, never what you were asked to write.** `markLabelsPrinted` returned
  `done: numbers.length` regardless of what the UPDATE matched, so a number belonging to another store
  (RLS filters it out, no error) counted as printed. `.returning()` is the only honest source.
- **A terminal order must never grow a live bill.** `createOrderPayment` had no `status` check, so a
  cancelled order could be given a real VA: the buyer pays, the callback marks it `berhasil`, and
  `creditSaleForPayment` then correctly skips `batal`/`retur` — money collected, no sale credited.
  Refusing at creation is the only place this stops, because the callback is right to skip it. It also
  refuses a SECOND bill while one is still `menunggu`.
- **ONE definition of "the order's payment", used by every screen** — `paid_at desc nulls last, id
  desc`, in both `data/orders.ts` and `data/order-detail.ts`. They used to order differently, so an
  order with more than one payment row could read COD on one screen and VA on the other — and COD is
  the fact `createShipment` turns into a cash-collection instruction for a courier.
- **A `"use server"` action that spends a PROVIDER's quota needs a capability, not a session.**
  `getShippingRates` was the only door in `actions/shipping.ts` any signed-in store user could open,
  and every call is a live KiriminAja rate request. It now takes `orders:write`, the same gate as the
  `createShipment` it pairs with.
- **Converting a throwing action to `{ ok, error }` is a TWO-file change.** Next masks a thrown Error
  in production, so merchant-actionable rules must be returned — but a caller that awaits and ignores
  the result will then report success over a save that never happened, which is worse than the digest.
  Change the action and its callers in the same commit. (`actions/flash.ts` + `flash-editor.tsx`,
  2026-07-31; `theme.ts` earlier.)
- **`isUuid` (`lib/uuid.ts`) before any `eq(table.id, segment)`.** Postgres THROWS `22P02` on a
  non-UUID string — a 500 where a 404 belongs — and `/produk/…` takes the catalog NUMBER, so merchants
  really do try `/diskon/1042`. One route guarded itself with a private regex; the three beside it did
  not, which is what a private copy always costs.
- **User-typed search strings are ESCAPED before they enter a LIKE pattern** (`@tokophi/lib/like`).
  Not injection — everything is parameterised — but `%` and `_` are wildcards and the merchant is
  typing a search box: measured, an unescaped `_` matched **all 842 orders**. It is one shared helper
  because the same regex had already been written twice by hand and a third site was missed.
- **Validate every URL parameter that reaches an enum cast.** `/pesanan?bayar=<anything>` was a 500
  (`invalid input value for enum payment_method`) because `bayar` was passed straight through while
  `tab` and `field` beside it were checked.
