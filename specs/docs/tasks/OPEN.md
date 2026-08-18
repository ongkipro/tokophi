# OPEN — current development handoff

**Refreshed 2026-08-18 after Stage 4 Task 4.7 integration.**

This file is a navigation handoff. It is not a second task board.

## Current status

- Unrestricted production release is blocked.
- Repository-root [`TASKS.md`](../../../TASKS.md) is the only active queue and release gate.
- The queue contains 13 P0 release blockers, 20 P1 high-priority items, and 9 P2 hardening items.
- TokoΦ Account is accepted as a product direction, not as deployed behavior. Its release scope remains an explicit task.
- Production mutation, deployment, credential rotation, and infrastructure changes remain owner-gated.

## Resume point

- **Last completed:** Stage 4 Task 4.7, persisted navigation menu creation. Executable evidence and the exact changed-file record are in root [`BUILD-LOG.md`](../../../BUILD-LOG.md).
- **Integrated baseline:** `integration/stage4-p0-wave1` at merge commit `fb6f04e`.
- **Next task:** Stage 4 Task 4.8, transactionally idempotent checkout order creation. The canonical requirement, targets, change, and acceptance check remain in root [`TASKS.md`](../../../TASKS.md).
- Do not skip to Task 4.9: Task 4.8 must first prove concurrent requests produce one order, one inventory decrement, and one stable replay identity.

## Start here

1. Read [`../AUDIT-SUMMARY.md`](../AUDIT-SUMMARY.md) for current evidence, limitations, and release gates.
2. Read [`../REQUIREMENTS.md`](../REQUIREMENTS.md) for accepted behavior and current `NOT MET` or `PARTIAL` status.
3. Execute root [`TASKS.md`](../../../TASKS.md) in its stated dependency order and parallel-lane contract.
4. Run Stage 7 only after Stages 4–6 are integrated.
5. Update requirement status, audit evidence, status, and release language only from executable proof.

If documents disagree, use this order:

1. Executable code, migrations, tests, and observed runtime evidence.
2. Accepted ADRs and the canonical domain owner named in [`../DEVELOPMENT_READINESS.md`](../DEVELOPMENT_READINESS.md).
3. [`../REQUIREMENTS.md`](../REQUIREMENTS.md), [`../AUDIT-SUMMARY.md`](../AUDIT-SUMMARY.md), and root [`TASKS.md`](../../../TASKS.md).
4. Dated audits, handoffs, worklogs, and historical task ledgers.

Never promote a dated observation into current behavior without rerunning its check.

## Active contracts

- Implemented architecture: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- Deployment and production safety: [`../DEPLOY.md`](../DEPLOY.md)
- Security posture: [`../SECURITY.md`](../SECURITY.md)
- Data model: [`../DATA_MODEL.md`](../DATA_MODEL.md)
- Observability and operations: [`../OBSERVABILITY.md`](../OBSERVABILITY.md)
- Privacy and compliance engineering: [`../PRIVACY-COMPLIANCE.md`](../PRIVACY-COMPLIANCE.md)
- Proposed TokoΦ Account behavior: [`../TOKOPHI_ACCOUNT_SPEC.md`](../TOKOPHI_ACCOUNT_SPEC.md)
- Proposed headless storefront behavior: [`../HEADLESS_STOREFRONT_SPEC.md`](../HEADLESS_STOREFRONT_SPEC.md)

## Historical evidence

The following files remain useful for incident detail and decision history, but do not own current work:

- [`NEXT.md`](./NEXT.md): long-form historical queue with duplicate identifiers and stale-state warnings.
- [`../BACKLOG.md`](../BACKLOG.md): historical priority ledger.
- [`../WORKLOG.md`](../WORKLOG.md): chronological implementation record.
- Dated files in this directory: session handoffs, audit waves, production measurements, and closed implementation contracts.

When a historical entry is still relevant, trace it to a current requirement and root task before changing code. Do not reopen or implement work solely because an old checkbox remains open.
