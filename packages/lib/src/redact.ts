/**
 * Replace a credential — raw and URL-encoded — with `[REDACTED]` in a message bound for a log, an
 * error column or a screen. ONE sanitiser for every provider whose key rides in a URL or an error
 * body (Mengantar's seller key, Kelola's webhook token): a private copy per provider is how the
 * weaker half survives a fix. Lifted out of `mengantar.ts`, which re-exports it unchanged.
 */
export function redactKey(message: string, key: string | null | undefined): string {
  if (!key) return message;
  let out = message;
  for (const s of new Set([key, encodeURIComponent(key)])) if (s) out = out.split(s).join("[REDACTED]");
  return out;
}
