# Buyer account local prototype

A fixture-only buyer journey. No backend, OTP provider, payment gateway, support delivery or production database is called by the local flows. Existing external store/brand links remain links; do not mistake them for local fixtures.

## Run

From this worktree:

```bash
PORT=4187 node prototypes/tokophi-account/dev-server.mjs
```

Open `http://127.0.0.1:4187/`. Use the prefilled sample phone and OTP `123456`. Changes are stored in this browser tab's `sessionStorage` and survive reload. Closing the tab ends the demo session. Use example data only. This storage and login simulation are not an authentication implementation.

Guest checkout is available from the login page or `/checkout?guest=1`. Guest edits require address review and a fresh shipping/payment selection. Signing in preserves entered guest values within the current page session.

## Implemented journeys

- Canonical Orders/Stores/Addresses/Account navigation, direct links, browser history, search/store/status filters, empty/error/not-found recovery.
- Status-first order detail; simulated payment continuation, expiry and delayed-status check; order-scoped help requests with pending-review history.
- Address add/edit/default/delete and profile editing; failed-save retry; order address snapshots stay unchanged.
- Claim demo order `DEMO-GUEST-001` with proof `CLAIM-246810` and explicit consent. Repeating a claim does not duplicate the order.
- Phone-change verification, simulated device revocation, store disconnect/reconnect, notification preferences, recovery/data-copy/closure/COD-review request records.
- Normal COD state by default. Warning/restricted policies remain proposed fixture behavior, not production rules.

Requests remain pending in this demo; it does not simulate a seller approving refunds, closing an account, or delivering messages. Payment outcomes change a fixture's status only, never transfer money.

## Review scenarios

| URL | Scenario |
| --- | --- |
| `/orders?scenario=empty` | Empty state with claim entry |
| `/orders?scenario=error` | Failure with retry |
| `/orders?scenario=partial` | Partial list |
| `/orders?scenario=loading` | Loading state |
| `/account?save=error` | First save in each opened dialog fails; retry preserves values |
| `/orders?otp=expired` | Fresh login refuses code until resend |
| `/orders?otp=delayed` | Fresh login shows delayed-delivery guidance |
| `/account?cod=warning` | Proposed COD warning |
| `/account?cod=restricted` | Proposed restriction and review request |
| `/orders/PHI-202865413Q8M/payment?payment=expired` | Expired payment; help instead of submitting |
| `/orders/PHI-202865413Q8M/payment?payment=delayed` | Recheck same order; do not pay twice |

Payment scenario URLs apply while that order is still unpaid in the demo. Start a fresh tab after simulating payment to review unpaid scenarios again.

## Verify

Uses the repository's existing Playwright installation and installed Google Chrome. No dependency or browser download is performed by the test.

```bash
node prototypes/tokophi-account/check-local.mjs
# Optional screenshots:
ACCOUNT_SCREENSHOTS=/tmp/tokophi-account-review node prototypes/tokophi-account/check-local.mjs
```

The check starts its own loopback server on an ephemeral port, uses isolated browser contexts, blocks and fails on external requests, and closes its own browser/server. Set `PLAYWRIGHT_CHANNEL=chromium` only when the matching browser is already installed. On this machine the ignored worktree `node_modules/playwright` links to the existing main checkout installation.

Sixteen behavioral checks cover navigation, filters, failure/retry, profile/address mutations, snapshot preservation, payment/help, claim proof/idempotency, phone/device/consent settings, OTP recovery, guest handoff/quote invalidation, inert editable text, conditional COD, responsive reflow and dialog keyboard behavior. They are not production security or end-to-end backend evidence.

## Tailscale development access

The server defaults to loopback. To bind only to this machine's Tailscale IPv4 address:

```bash
HOST="$(tailscale ip -4)" PORT=4187 node prototypes/tokophi-account/dev-server.mjs
```

Verified on this machine: `http://100.127.67.86:4187/`. The viewing device must be connected to the tailnet and allowed by its access rules. Plain HTTP IP origins lack `crypto.randomUUID`; local address IDs use `crypto.getRandomValues`, which remains available in that context. This does not change the fixture-only identity boundary.

## Seller visual alignment

The buyer prototype reuses the Seller design values from `apps/admin/app/globals.css` (including its final indigo override), `Sidebar`, `Topbar`, `AdminChrome`, `PageHeader` and shared UI Card/Button/Input/Badge sources. The desktop sidebar is 256px, header 64px, content padding 24px and page title 24px. Card heading/body are 16px/14px; desktop controls 32px and mobile targets 44px. Buyer navigation remains task-specific.

Per the owner's follow-up, desktop content is centered within the area beside the sidebar and capped at 1120px including padding (1072px inner width). Header and canvas continue across that area. At 1920px the content's left edge is 528px, with 272px of free space on each side within the main area.

Geist Latin is copied without modification from the local Seller Next.js font build; `fonts.css` retains its original font-face definition. The upstream SIL Open Font License is included at `assets/geist-LICENSE.txt`, sourced from https://github.com/vercel/geist-font/blob/main/LICENSE.txt. Fonts are served locally, with no runtime font-CDN request.

Visual reference was rendered locally from compiled Seller CSS and source-derived shell markup, explicitly as a reference fixture; no authenticated merchant session or production page was accessed.
