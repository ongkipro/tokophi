-- Cron liveness — one row per sidecar, so a dead poller is VISIBLE instead of silent.
--
-- `cron-tracking` (docker-compose.coolify.yml, `sleep 900`) is the thing that makes a waybill appear
-- without the merchant pressing anything. Its own compose comment records `awbFilled` sitting at 0 for
-- a WEEK while the container was not running. It prints a timestamp on every tick — to `docker logs`,
-- which nobody opens without a reason — so the first person to notice the next outage would be a
-- merchant on the phone about a resi that never came. This table is what Super Admin → Analitik →
-- Sistem reads to say "terakhir jalan N menit lalu", in red once the run is overdue.
--
-- ONE ROW PER JOB, UPSERTED. Not an append-only log and deliberately NOT `platform_activity`: that is
-- the operator's audit feed, rendered on the dashboard, and at one row per tick these three jobs would
-- write ~1.630 rows a day (tracking-events wakes every 60 s) and bury every real event under them —
-- with nothing pruning it. "Is it alive right now" needs exactly one row, never grows, and reads as a
-- single primary-key lookup.
--
-- `interval_sec` is REPORTED BY THE SIDECAR (`?every=<seconds>` in the wget URL, from the same
-- variable its `sleep` uses), never hard-coded here — the staleness threshold has to come from the
-- loop's own cadence, and a second copy of "900" in application code goes stale the day someone edits
-- the compose file. NULL means the caller did not say, and the reader then declines to judge rather
-- than invent a number.
--
-- `result` is the endpoint's own run summary ({scanned, advanced, awbFilled, …}). A job that runs on
-- schedule and fills nothing, every time, is also a failure; "it ran" alone cannot show that.
--
-- No `store_id`: this is platform state, cross-tenant by nature, read only by the control plane. It is
-- therefore outside `verify-rls`'s store-scoped set by construction, like `platform_activity`.
--
-- Idempotent (CLAUDE.md): drizzle applies the whole pending batch in ONE transaction, so a single
-- "already exists" rolls back every migration behind it while printing "migrations applied
-- successfully".
create table if not exists "cron_runs" (
  "job" text primary key,
  "last_run_at" timestamp with time zone default now() not null,
  "interval_sec" integer,
  "ok" boolean default true not null,
  "duration_ms" integer,
  "result" jsonb
);

comment on table "cron_runs" is
  'Liveness of the compose cron sidecars — one upserted row per job. Read by Super Admin -> Analitik -> Sistem.';
comment on column "cron_runs"."interval_sec" is
  'The sidecar loop own sleep, forwarded as ?every=<seconds>. NULL = not reported, so no staleness verdict is possible.';
comment on column "cron_runs"."result" is
  'The run summary the endpoint returns (scanned/awbFilled/claimed/...). A job that runs and achieves nothing is also a failure.';
