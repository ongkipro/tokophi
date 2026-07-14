"use client";
import * as React from "react";
import { Button } from "@tokophi/ui/button";
import { Textarea } from "@tokophi/ui/textarea";
import { Send } from "lucide-react";
import { cn } from "@tokophi/ui/lib/utils";

// The shared thread: bubble list + composer. The spec (§5c) wants /bantuan, /tiket, /obrolan and the
// storefront widget to render the SAME shape — this is that component, written generic (sender is a
// free string, labels are props) so slice 6 can point the two ticket screens at it without a rewrite.
// It is NOT wired into them here: those files belong to another workstream right now.

export type ThreadMessage = { id: string; sender: string; body: string; createdAt: string };

// Timestamps are ABSOLUTE (never a Date.now()-derived "5 menit lalu" in a render path — the
// determinism rule in CLAUDE.md; the inbox list gets its relative time as a number computed on the
// server). They are still locale/timezone-formatted, and the container's timezone need not match the
// merchant's browser, so the one <time> element carries suppressHydrationWarning — the value is
// identical, only its rendering can differ.
const time = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Thread({
  messages,
  mineSender,
  labels,
  className,
}: {
  messages: ThreadMessage[];
  /** Which sender value is "us" (right-hand bubbles). */
  mineSender: string;
  labels: Record<string, string>;
  className?: string;
}) {
  const endRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div className={cn("space-y-3", className)}>
      {messages.map((m) => {
        if (m.sender === "system") {
          return (
            <p key={m.id} className="text-center text-xs text-muted-foreground">
              {m.body}
            </p>
          );
        }
        const mine = m.sender === mineSender;
        return (
          <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                mine ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              <div className={cn("mb-0.5 text-[11px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                {labels[m.sender] ?? m.sender} ·{" "}
                <time dateTime={m.createdAt} suppressHydrationWarning>
                  {time(m.createdAt)}
                </time>
              </div>
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

export function Composer({
  onSend,
  disabled,
  pending,
  placeholder = "Tulis balasan…",
}: {
  onSend: (body: string) => void;
  disabled?: boolean;
  pending?: boolean;
  placeholder?: string;
}) {
  const [body, setBody] = React.useState("");
  const send = () => {
    const b = body.trim();
    if (!b) return;
    setBody("");
    onSend(b);
  };
  return (
    <div className="flex items-end gap-2">
      <Textarea
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={placeholder}
        maxLength={2000}
        disabled={disabled}
        className="min-h-11 flex-1"
      />
      <Button className="gap-1.5" disabled={disabled || pending || !body.trim()} onClick={send}>
        <Send className="size-4" /> Kirim
      </Button>
    </div>
  );
}
