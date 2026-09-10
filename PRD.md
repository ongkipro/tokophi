# PRD — TokoΦ (entrypoint)

> **This file is the entrypoint the authority table names for "Product scope and non-goals"; the
> product requirements themselves live in [`specs/PRD.md`](specs/PRD.md) (v0.5, rewritten against the
> code and the database — everything there is verified or explicitly labelled aspirational).** Until
> 2026-09-11 this path held the PRD of the **landing site only**, so the authority map routed "product
> scope" into a document about the marketing pages. That PRD is preserved, unchanged, at
> [`specs/docs/LANDING_PRD.md`](specs/docs/LANDING_PRD.md).

| Need | Read |
|---|---|
| What the product is, who it is for, what it deliberately is not | [`specs/PRD.md`](specs/PRD.md) |
| Verifiable requirements and their current status (`F-*`, `NF-*`) | [`specs/docs/REQUIREMENTS.md`](specs/docs/REQUIREMENTS.md) |
| The apex marketing site (`tokophi.com`) | [`specs/docs/LANDING_PRD.md`](specs/docs/LANDING_PRD.md) |
| Feature specs beside the PRD | [`specs/PROMO_SPEC.md`](specs/PROMO_SPEC.md) · [`specs/THEME_EDITOR_SPEC.md`](specs/THEME_EDITOR_SPEC.md) · [`specs/docs/CHAT_SPEC.md`](specs/docs/CHAT_SPEC.md) · [`specs/docs/HEADLESS_STOREFRONT_SPEC.md`](specs/docs/HEADLESS_STOREFRONT_SPEC.md) · [`specs/docs/TOKOPHI_ACCOUNT_SPEC.md`](specs/docs/TOKOPHI_ACCOUNT_SPEC.md) |
| Decisions that shaped the scope | [`DECISIONS.md`](DECISIONS.md) → [`specs/decisions/`](specs/decisions/) |
| What is built (the record, not the design) | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| What to build next | [`TASKS.md`](TASKS.md) (the one execution queue) |

**Non-goals, in one line** (full list in `specs/PRD.md`): no Themes marketplace, no Apps/Plugins, no
buyer accounts at checkout (guest is the normal case), no provider brands shown to merchants or
shoppers (ADR 0004), no per-merchant payment channels or fee-bearer choice (platform-managed, ADR 0004).
