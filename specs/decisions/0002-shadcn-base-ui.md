# ADR 0002 — shadcn/ui on Base UI (not Radix)

**Status:** accepted (as installed) · **Date:** 2026-07-01

## Context
`npx shadcn@latest init` on Next.js 16 installed shadcn/ui built on **Base UI (`@base-ui/react` 1.6.0)**, not Radix. Base UI's composition/API differs from the Radix-era shadcn most examples assume, which caused build/console errors until adapted.

## Decision
Keep the installed Base UI variant (don't fight the toolchain) and standardize on its API across the codebase.

## Consequences — house rules (also in `AGENTS.md`)
- **Composition uses the `render` prop, not `asChild`:** `<DropdownMenuTrigger render={<Button/>} />` (Sheet/Dialog/Tooltip too).
- **Avoid the `Select` component** (Base UI API + placeholder handling differ) — use `DropdownMenu`, `Tabs`, or buttons for pickers/filters.
- **`Button` rendered as a Link/anchor needs `nativeButton={false}`** or Base UI logs a console.error ("expected a native `<button>`") that surfaces as "1 Issue" in the dev overlay.
- Event props: `onValueChange` (Tabs/Select), `onCheckedChange` (Switch/Checkbox).
- Definition of done includes **console-clean** (0 dev-overlay issues), not just a green build.

## Alternatives considered
Re-init shadcn on Radix — rejected: more churn, fights the default toolchain, and Base UI is fine once the rules above are followed.
