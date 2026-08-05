"use client";

import { Search } from "lucide-react";
import { Input } from "@tokophi/ui/input";
import { cn } from "@tokophi/ui/lib/utils";

/**
 * The filter box that sits above every list screen.
 *
 * ── WHY IT IS A COMPONENT ────────────────────────────────────────────────────────────────────────
 * The wrapper + absolutely-positioned magnifier + `pl-8` was hand-copied into TWELVE screens, and
 * every copy was missing the same thing. Measured in Chromium on 2026-08-05
 * (`Accessibility.getPartialAXTree`): each one's accessible name came from **`placeholder` and
 * nothing else** — the accname spec's last-resort fallback. That is not "nameless", and the wave-8
 * note that a screen reader hears only "edit text" here is wrong; it hears "Cari produk…". But a
 * placeholder is the weakest possible name: it is the one label the sighted user loses the moment
 * they type, it is not exposed as a name by every AT, and the role stays `textbox` when the control
 * is a search field.
 *
 * `label` is REQUIRED, and that is the whole point — a component whose name can be forgotten is the
 * component that was copied twelve times without one. `placeholder` stays optional and separate,
 * because the two say different things: "Cari produk" is what the box IS, "Cari nama, nomor, atau
 * produk…" is a hint about what it matches.
 *
 * Deliberately NOT `type="search"`: it would upgrade the role to `searchbox`, but Chromium also
 * draws its own `::-webkit-search-cancel-button` inside the field, which is a visible change to
 * twelve screens that nobody asked for. The name is the defect; the role is not.
 */
export function SearchInput({
  label,
  value,
  onValueChange,
  placeholder,
  className,
  inputClassName,
  ...rest
}: {
  /** Announced name. Required — see above. */
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  /** Classes for the positioning wrapper (width, flex behaviour). */
  className?: string;
  /** Classes for the input itself (height, responsive width). `pl-8` is always applied. */
  inputClassName?: string;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "className" | "type">) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label={label}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        className={cn("pl-8", inputClassName)}
        {...rest}
      />
    </div>
  );
}
