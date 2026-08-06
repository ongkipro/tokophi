"use client";

import * as React from "react";
import Link from "next/link";
import { Inbox, SearchX, TriangleAlert } from "lucide-react";

import { Button } from "@tokophi/ui/button";
import { Card } from "@tokophi/ui/card";
import { cn } from "@tokophi/ui/lib/utils";

/**
 * The three states a list can be empty in. They are DIFFERENT SENTENCES, and collapsing them is the
 * defect this component exists to stop: a brand-new store that has never had a review was told
 * *"Tidak ada ulasan yang cocok."* — advice about a search nobody ran, on a screen whose real job at
 * that moment is to say what a review IS and where one comes from.
 *
 *  - `kosong` — the store has never had one of these. This is ONBOARDING: name the thing, then name
 *    the one press that starts it. Never offer "hapus filter" here; there is no filter.
 *  - `filter`  — rows exist, this search/tab/date range matched none of them. Offer to WIDEN the net.
 *    Never offer "tambah data" here; the data is already there, behind the filter.
 *  - `galat`   — the read failed. Say so, and offer the retry. Never dress a failure as emptiness —
 *    "belum ada" over a database that is down is a lie the merchant acts on.
 *
 * The plinth's border carries the distinction, so the three read apart before the text is read:
 * dashed = a slot waiting to be filled · solid = nothing is wrong, the net is narrow · tinted =
 * something broke.
 */
export type EmptyStateKind = "kosong" | "filter" | "galat";

export type EmptyStateAction = {
  /** Names what happens when it is pressed ("Buat segmen"), never "Mulai". */
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: React.ComponentType<{ className?: string }>;
};

const DEFAULT_ICON: Record<EmptyStateKind, React.ComponentType<{ className?: string }>> = {
  kosong: Inbox,
  filter: SearchX,
  galat: TriangleAlert,
};

const PLINTH: Record<EmptyStateKind, string> = {
  kosong: "border-2 border-dashed border-border text-muted-foreground",
  filter: "border border-border bg-muted text-muted-foreground",
  galat: "border border-destructive/30 bg-destructive/10 text-destructive",
};

function ActionButton({
  action,
  variant,
}: {
  action: EmptyStateAction;
  variant: "default" | "outline";
}) {
  const Icon = action.icon;
  const content = (
    <>
      {Icon && <Icon className="size-4" />}
      {action.label}
    </>
  );
  // Base UI logs a console.error for a non-native button, so a Button-as-Link needs nativeButton={false}.
  return action.href ? (
    <Button variant={variant} nativeButton={false} render={<Link href={action.href} />}>
      {content}
    </Button>
  ) : (
    <Button variant={variant} onClick={action.onClick}>
      {content}
    </Button>
  );
}

export function EmptyState({
  kind = "kosong",
  icon,
  title,
  desc,
  action,
  secondary,
  card = false,
  className,
}: {
  kind?: EmptyStateKind;
  /** Only worth overriding on `kosong`, where the screen's own subject is the clearer glyph. */
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  desc?: React.ReactNode;
  action?: EmptyStateAction;
  secondary?: EmptyStateAction;
  /** Wrap in a Card. Off by default: most call sites are already inside one, or inside a <td>. */
  card?: boolean;
  className?: string;
}) {
  const Glyph = icon ?? DEFAULT_ICON[kind];
  const body = (
    <div
      className={cn(
        // `whitespace-normal` is load-bearing, not tidying: TableCell ships `whitespace-nowrap`, so
        // inside a colSpan cell the description ran past its own max-width on ONE line instead of
        // wrapping. Fixed here rather than at each call site — the next table to use this would
        // otherwise inherit the same defect silently.
        "flex flex-col items-center justify-center gap-3 px-6 py-14 text-center whitespace-normal",
        className,
      )}
    >
      <div className={cn("flex size-12 items-center justify-center rounded-xl", PLINTH[kind])}>
        <Glyph className="size-5" />
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">{title}</p>
        {desc ? (
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">{desc}</p>
        ) : null}
      </div>

      {action || secondary ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action ? <ActionButton action={action} variant="default" /> : null}
          {secondary ? <ActionButton action={secondary} variant="outline" /> : null}
        </div>
      ) : null}
    </div>
  );

  return card ? <Card className="py-0">{body}</Card> : body;
}
