# Buyer account UX review — 2026-09-13

Scope: existing local prototype only; advisory review, no implementation or policy approval. Actor: a buyer tracking purchases across stores, continuing payment, seeking order help, and managing reusable account details. Guest checkout remains available. Main account specification and ADR remain proposed; this review does not supersede Task 5.8 or the account specification.

## Executed evidence

- Local prototype server on port 4187; stopped only the process started for this review.
- Existing Playwright with installed Google Chrome (`channel: chrome`); bundled browser was absent. No installation.
- Demo OTP login, return-to-orders action and mobile Account navigation exercised.
- Authenticated routes `/orders`, `/addresses`, `/account`, `/notifications`, `/orders?scenario=empty` inspected at widths 1280, 390 and 320, height 900. Each produced zero page-level horizontal overflow.
- Screenshots visually inspected: desktop order detail, mobile order detail, mobile account. This is not a full keyboard, contrast, screen reader or checkout audit.
- Initial unauthenticated route captures only showed login and are not evidence of account layout. The separate authenticated capture pass establishes account layout evidence.
- Evidence retained at `~/Documents/work/notes/tokophi-account-ux-2026-09-13/` (JSON measurements and selected screenshots).

## Ranked findings and proposed acceptance criteria

| Priority | Evidence / gap | Proposed requirement and acceptance |
| --- | --- | --- |
| P0 | `renderRoute` matches `orders` with `startsWith("order")`; browser login and Back both render the first order at `/orders`. | Exact list/detail routing; login shows the order list, detail opens the chosen order, Back restores list/filter state. |
| P0 | Navigation emits `/profile`; router accepts `/account`. Browser mobile Account click displays the first order. | One canonical account path for sidebar, mobile nav and avatar; each opens the profile. |
| P0 | Authenticated `/orders?scenario=empty` renders a real fixture order. Unknown order numbers fall back through the list route to the first order. | Empty, error and unknown-order states must never substitute an unrelated order; explain recovery and preserve navigation. |
| P1 | Address/profile edits, contact support, store disconnect and COD appeal only dispatch demo toasts. | Complete local interactive forms first: validation, cancel, pending/failure/success, retained input and observable changed state. Label fixture persistence honestly. |
| P1 | Detail presents tracking/payment/receipt equally; payment info and help occur late on mobile. Pending QRIS has no usable continuation. | Status-led summary near the top; one appropriate primary action per state. Show amount/deadline and valid continuation for pending payment; shipping progress for shipped orders; contextual help always available. Do not create duplicate orders to recover payment. |
| P1 | `renderOrders` has only All/Active/Done; Done groups completed, cancelled and return-in-progress. No search/store filter. | Search by order/product, store filter and meaningful payment/fulfilment/return states; pagination when needed. An open return stays actionable. |
| P1 | Generic Contact merchant toast; no issue intake or request tracking. | Order-scoped help with order reference, selected issue and clear recipient; return/cancellation/refund request paths only under accepted store/platform policy. Request acceptance must not imply automatic approval. |
| P1 | Demo OTP covers wrong code and edit phone; no provider-delay/expiry/recovery/session lifecycle journey. | Define first/returning user, OTP delay/expiry/retry, lost number, number change verification and active-device revocation. Preserve intended destination across login. |
| P1 | Claim modal exists but no rendered `open-claim` entry point was found. Connection status is not accompanied by a full consent/claim/unlink journey. | Explain missing guest orders; provide an explicit claim entry and possession-proof flow. Explain what each store receives and consequences of unlinking. Define account closure/export flow separately from order retention policy. |
| P2 | Mobile account begins with identity, counters and a large COD warning; security settings are far below. Only warning/restricted COD fixtures exist. | Prioritize profile, contact, addresses and security. Show COD notices when relevant, with normal/unrestricted state and a complete review path. Do not present proposed thresholds as accepted business policy. |
| P2 | User content repeats fixture, tenant, projection and API explanations; payment exposes system reference section. | Keep a clear prototype banner; move developer detail to review documentation or secondary troubleshooting. Use buyer-facing language and a human-readable order status heading; retain order number as copyable secondary information. |

## Direction

Keep the four primary destinations: Orders, Stores, Addresses and Account. Orders is the default landing destination, with action-required items prioritized. Avoid adding a separate KPI dashboard. Separate order updates from marketing preferences; the prototype already starts marketing disabled. Store history and consented connections remain distinct objects even when the same stores appear in both.

Visual verdict: REVISE information hierarchy. Functional verdict: REVISE due to reproduced navigation failures. Accessibility conformance: UNVERIFIED beyond limited reflow measurements. Backend and production: not tested.

## Reference rationale

- https://help.shopify.com/en/manual/customers/customer-accounts — inspected official documentation: order management, profile/address editing and after-sales actions support the proposed focus on completing buyer tasks. Shopify identity merging and session policies are not adopted for TokoPhi's global identity design.
- https://www.w3.org/WAI/tutorials/forms/notifications/ — inspected official guidance: concise field-associated errors, correction instructions and clear success feedback inform the proposed form acceptance criteria.

## Suggested sequence

1. Correct and browser-verify navigation and empty/error/not-found behavior.
2. Complete local order/payment/help and profile/address form journeys.
3. Review claim/consent/recovery/session and relevant COD states.
4. Resolve owner decisions in canonical account documents before backend work.
