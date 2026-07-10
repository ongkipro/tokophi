import type { Overrides } from "@measured/puck";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

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

export function FieldWrapper({ label, name, children }: { label?: string; name: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground">{label ?? humanize(name)}</Label>
      {children}
    </div>
  );
}

export const puckFieldOverrides: Partial<Overrides["fieldTypes"]> = {
  text: ({ field, name, value, onChange, readOnly }) => (
    <FieldWrapper label={field.label} name={name}>
      <Input value={value ?? ""} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />
    </FieldWrapper>
  ),
  textarea: ({ field, name, value, onChange, readOnly }) => (
    <FieldWrapper label={field.label} name={name}>
      <Textarea value={value ?? ""} disabled={readOnly} rows={3} onChange={(e) => onChange(e.target.value)} />
    </FieldWrapper>
  ),
  number: ({ field, name, value, onChange, readOnly }) => (
    <FieldWrapper label={field.label} name={name}>
      <Input
        type="number"
        value={value ?? ""}
        disabled={readOnly}
        min={"min" in field ? field.min : undefined}
        max={"max" in field ? field.max : undefined}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </FieldWrapper>
  ),
  select: ({ field, name, value, onChange, readOnly }) => {
    const options = "options" in field ? field.options : [];
    return (
      <FieldWrapper label={field.label} name={name}>
        <select
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
      </FieldWrapper>
    );
  },
};
