# Observability — where the signals are documented

> **NOT WRITTEN as a standalone document.** `specs/README.md` and `specs/docs/tasks/OPEN.md` have
> linked this path since 2026-08 while nothing was ever committed here (`git log --all` → nothing).
> This placeholder exists so the link resolves to a statement of where the content actually lives,
> not to a 404. It carries no signal definitions of its own.
>
> | What you want | Where it is |
> |---|---|
> | The production probe contract (URL → expected status → max latency) | repository-root `OBSERVABILITY.md` (`ops/tokophi-probe.sh` runs it) |
> | SLI / SLO / SLA, RTO / RPO, single points of failure, the recovery runbook | `SLA-DRP.md` |
> | The cron sidecars, container logs, how to verify a deploy really landed | `DEPLOY.md` |
> | Known alerting blind spots (no external uptime monitor, no alert channel) | `tasks/2026-08-06-alerting-gaps.md` and root `TASKS.md` Stage 8 |
>
> If a signals document is ever written, it replaces this file at this path.
