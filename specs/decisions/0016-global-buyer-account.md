# ADR 0016 — Global buyer account

> **NOT WRITTEN on `main` — Task 5.8 owner decision.** `specs/README.md`'s ADR table and
> `REQUIREMENTS.md` F-K11 have linked this number since 2026-08 while `specs/decisions/` ended at
> `0015`. This placeholder exists so the link resolves to a record that says the decision is NOT
> taken, instead of a 404 that reads like a lost file.
>
> - Status: **PROPOSED, not accepted.** A 123-line draft ("Global buyer identity with isolated
>   per-store customer projections") exists on the unmerged branch `feature/buyer-account-local`
>   (commit `8dc12d7`). No owner decision is recorded anywhere in the repository.
> - The decision itself — build, defer, or drop the buyer account — is **Task 5.8** in root
>   `TASKS.md`. When it is taken, the accepted ADR text replaces this stub under this number (or the
>   number is retired the way 0010 was, and every link to it removed in the same change).
> - Nothing in the codebase depends on this record: the runtime is not deployed
>   (`grep -rn "passwordHash" apps/storefront/src` → nothing).
