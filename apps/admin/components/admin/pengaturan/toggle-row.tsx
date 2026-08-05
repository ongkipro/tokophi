"use client"

import * as React from "react"

import { cn } from "@tokophi/ui/lib/utils"
import { Switch } from "@tokophi/ui/switch"

export function ToggleRow({
  icon,
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  icon?: React.ReactNode
  /** The visible title. A node, not a string, because several rows put an icon or a muted
      qualifier inside it — and the name has to come from what is on screen, not a paraphrase. */
  title: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onCheckedChange: (value: boolean) => void
  disabled?: boolean
  className?: string
}) {
  const id = React.useId()
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 p-3 transition-colors hover:bg-muted/40",
        className
      )}
    >
      {icon != null && (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4.5">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        {/* `title` sits in a SIBLING of the switch, so on its own it is merely adjacent, not
            associated — a screen reader announced a bare "switch, on". It carried an
            `aria-label={title}` for a while, which named it but left two copies of the same
            sentence that could drift apart, and left the text unclickable.
            `htmlFor` is the native association: Base UI's Switch finds the matching `<label>` and
            publishes it as `aria-labelledby` (measured in Chromium on `/produk/[id]`, where
            `<Label htmlFor="p-hasvar">` surfaces as `aria-labelledby="p-hasvar-label"`), AND the
            browser makes the words a click target for the toggle. One source, both jobs. */}
        <label htmlFor={id} className="block text-sm font-medium">
          {title}
        </label>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}
