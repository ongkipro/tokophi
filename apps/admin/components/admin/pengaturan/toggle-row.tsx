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
  className,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
  className?: string
}) {
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
        <p className="text-sm font-medium">{title}</p>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
