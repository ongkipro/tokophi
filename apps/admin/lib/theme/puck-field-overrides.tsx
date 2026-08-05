import * as React from "react";
import type { Overrides } from "@measured/puck";
import { Input } from "@tokophi/ui/input";
import { Textarea } from "@tokophi/ui/textarea";
import { Label } from "@tokophi/ui/label";

// Puck's own field inputs (hashed CSS-module styling, not overridable via variables) feel like
// a generic dev tool next to the rest of the admin. Swapping in our own shadcn/Base-UI Input,
// Textarea, and native select — via Puck's official `overrides.fieldTypes` extension point —
// makes the builder's form panel match the rest of TokoΦ instead of looking bolted-on.
//
// Overriding a field TYPE replaces its whole render, including the label Puck would otherwise
// draw — so each override below renders its own label (falling back to a humanized prop name
// for the rare field without an explicit `label` in puck-config.tsx).
const humanize = (name: string) =>
  name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/**
 * 🔴 `children` is a FUNCTION of the id, and that is the whole point of this component.
 *
 * It used to render `<Label>{label}</Label>` with no `htmlFor` above a control with no `id`. On
 * screen that is indistinguishable from a labelled field — which is why it survived review — but
 * nothing associated the two, so Blink computed **no accessible name at all** for any of them.
 * Measured 2026-08-05 in Chromium (`Accessibility.getPartialAXTree`) on `/tema/[id]` with each
 * section selected in turn: **30 controls across 8 sections, every one of them nameless.** A
 * merchant on a screen reader editing their storefront heard "edit text" and nothing else, on the
 * one screen that is nothing BUT form fields.
 *
 * Four field types flow through here, so this is the one place to fix — and passing the id down as
 * an argument rather than trusting each override to remember `id={id}` is what stops the fifth
 * field type from quietly shipping unlabelled. `tsc` refuses a child that is not a function.
 */
function FieldWrapper({
  label,
  name,
  children,
}: {
  label?: string;
  name: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-muted-foreground">
        {label ?? humanize(name)}
      </Label>
      {children(id)}
    </div>
  );
}

export const puckFieldOverrides: Partial<Overrides["fieldTypes"]> = {
  text: ({ field, name, value, onChange, readOnly }) => (
    <FieldWrapper label={field.label} name={name}>
      {(id) => <Input id={id} value={value ?? ""} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />}
    </FieldWrapper>
  ),
  textarea: ({ field, name, value, onChange, readOnly }) => (
    <FieldWrapper label={field.label} name={name}>
      {(id) => (
        <Textarea id={id} value={value ?? ""} disabled={readOnly} rows={3} onChange={(e) => onChange(e.target.value)} />
      )}
    </FieldWrapper>
  ),
  number: ({ field, name, value, onChange, readOnly }) => (
    <FieldWrapper label={field.label} name={name}>
      {(id) => (
      <Input
        id={id}
        type="number"
        value={value ?? ""}
        disabled={readOnly}
        min={"min" in field ? field.min : undefined}
        max={"max" in field ? field.max : undefined}
        onChange={(e) => {
          // Clamped HERE because this override replaces Puck's own number field, and Puck's built-in
          // clamp (`if (numberValue < field.min) return;`) went with it. `min`/`max` below are HTML
          // attributes only: they colour the box `:invalid` and are never enforced, because no native
          // form validation runs in this editor. So `0`, `-5` and a cleared box all reached jsonb.
          if (e.target.value === "") return onChange(undefined);
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          const lo = "min" in field && typeof field.min === "number" ? field.min : -Infinity;
          const hi = "max" in field && typeof field.max === "number" ? field.max : Infinity;
          onChange(Math.min(Math.max(n, lo), hi));
        }}
      />
      )}
    </FieldWrapper>
  ),
  select: ({ field, name, value, onChange, readOnly }) => {
    const options = "options" in field ? field.options : [];
    return (
      <FieldWrapper label={field.label} name={name}>
        {(id) => (
          <select
            id={id}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            value={String(value ?? "")}
            disabled={readOnly}
            onChange={(e) => {
              const match = options.find((o) => String(o.value) === e.target.value);
              onChange(match ? match.value : e.target.value);
            }}
          >
            {options.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </FieldWrapper>
    );
  },
};
