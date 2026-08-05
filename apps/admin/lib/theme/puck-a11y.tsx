"use client";

import * as React from "react";

/**
 * Names for the two controls Puck renders itself and gives no accessible name — N56.
 *
 * ── MEASURED, IN A BROWSER, NOT GREPPED ──────────────────────────────────────────────────────────
 *
 * `/tema/<id>` with the Hero section selected, walking every `button`, `select` and `input` on the
 * page and computing each one's name the way a screen reader would (`aria-label` → `title` →
 * `<label for>` → own text): **41 controls, and exactly 2 came back nameless** —
 *
 *   SELECT ._ViewportControls-zoomSelect_…   the viewport zoom picker (its `<option>`s carry no text
 *                                            either, so there is nothing to fall back to)
 *   BUTTON ._ArrayField-addButton_…          the "add another item" button inside every array field
 *
 * Six sections in `puck-config.tsx` use `type: "array"` (slides, features, logos, links…), so the
 * second one is on the path of anyone building a carousel or a feature list.
 *
 * ── WHY THIS IS A DOM PATCH AND NOT AN OVERRIDE ──────────────────────────────────────────────────
 *
 * Puck's `overrides` map (`walk-tree-*.d.mts`) offers no hook for either control. The array field's
 * only entry point is `fieldTypes.array`, which replaces the field ENTIRELY — its drag-reorder,
 * add/remove and nested rendering would all have to be rebuilt to add one attribute, and the same is
 * true of `header` for the zoom select. Re-implementing two vendor widgets to name them is a far
 * larger risk than the defect: `puck-field-overrides.tsx` overrides four field types, and each is a
 * plain input we can render honestly — an array field is not.
 *
 * Setting the attribute is otherwise a no-op: it changes no behaviour, no layout and no value, and
 * it never overwrites a name Puck may add later (`if (!el.getAttribute("aria-label"))`).
 *
 * // lazy: coupled to Puck's CSS-module class NAMES (the `_…_hash_nn` suffix changes per build, the
 * // component-name prefix does not). If @measured/puck renames or names these controls itself, the
 * // selectors stop matching — so a mount that finds neither target warns in dev rather than going
 * // quietly back to two nameless controls. The upgrade path is upstream: an `aria-label` on Puck's
 * // own ArrayField/ViewportControls, or an override point for them; then delete this file.
 */
const TARGETS = [
  { selector: '[class*="ViewportControls-zoomSelect"]', label: "Perbesaran tampilan" },
  { selector: '[class*="ArrayField-addButton"]', label: "Tambah item" },
];

export function PuckA11yLabels() {
  React.useEffect(() => {
    const apply = () => {
      let matched = 0;
      for (const t of TARGETS) {
        for (const el of document.querySelectorAll(t.selector)) {
          matched++;
          if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", t.label);
        }
      }
      return matched;
    };

    apply();
    // The array field's button only exists while a section that HAS an array field is selected, so a
    // one-shot pass at mount would miss it every time. `childList` only — writing an attribute does
    // not fire it, so this cannot re-trigger itself.
    const observer = new MutationObserver(() => apply());
    observer.observe(document.body, { childList: true, subtree: true });

    // The zoom control is part of Puck's chrome and is on screen from the first paint. If it is not
    // there four seconds in, the selector no longer matches what Puck renders — say so on the screen
    // where someone can act on it, instead of silently restoring the bug.
    const alarm = setTimeout(() => {
      if (process.env.NODE_ENV !== "production" && !document.querySelector(TARGETS[0].selector)) {
        console.warn(
          "[puck-a11y] Puck's zoom control no longer matches its selector — the N56 labels are probably dead. See lib/theme/puck-a11y.tsx.",
        );
      }
    }, 4000);

    return () => {
      observer.disconnect();
      clearTimeout(alarm);
    };
  }, []);

  return null;
}
