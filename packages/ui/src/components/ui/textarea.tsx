import * as React from "react"

import { cn } from "../../lib/utils"

type TextareaProps = React.ComponentProps<"textarea"> & {
  error?: React.ReactNode
}

function Textarea({
  className,
  id,
  error,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  ...props
}: TextareaProps) {
  const generatedErrorId = React.useId()
  const errorId = `${id ?? generatedErrorId}-error`
  const hasError = Boolean(error)
  const describedBy = [ariaDescribedBy, hasError ? errorId : undefined]
    .filter(Boolean)
    .join(" ") || undefined

  return (
    <>
      <textarea
        id={id}
        data-slot="textarea"
        aria-invalid={hasError ? true : ariaInvalid}
        aria-describedby={describedBy}
        className={cn(
          "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          className
        )}
        {...props}
      />
      {hasError && (
        <div id={errorId} aria-live="polite" className="sr-only">
          {error}
        </div>
      )}
    </>
  )
}

export { Textarea }
