// The PURE half of the conversion senders — no DB, no `server-only`, so it can be exercised with
// fixtures (same split as `cod-policy.ts` / `cod.ts`). `capi.ts` holds the network half and re-exports
// this, so callers still import one module.

/**
 * A provider error body can quote our own request back at us — Meta and TikTok both echo the payload
 * on a rejection, and the payload carries the access token. This is what stands between that body and
 * `tracking_event_deliveries.last_error_message`, a column the merchant reads on screen and pastes into
 * support tickets. Truncated too, so one provider essay cannot fill the column (§24.1).
 */
export function sanitize(msg: unknown): string {
  let s = typeof msg === "string" ? msg : JSON.stringify(msg ?? "");
  s = s.replace(/(access_?token|api_secret|Access-Token)("|')?\s*[:=]\s*("|')?[^"'&,\s}]+/gi, "$1=[redacted]");
  // Long opaque blobs are almost always credentials; a 30+ char unbroken token has no diagnostic value.
  s = s.replace(/\b[A-Za-z0-9_-]{30,}\b/g, "[redacted]");
  return s.slice(0, 400);
}

/** HTTP status → retry decision, shared by all three providers (ADR 0012 §23.2). */
export function classify(status: number, text: string): { ok: boolean; retryable: boolean; errorCode?: string; errorMessage?: string } {
  if (status >= 200 && status < 300) return { ok: true, retryable: false };
  // 429 + 5xx are the provider's problem and will pass; everything else is OUR configuration and will
  // still be wrong on the next attempt — retrying it just burns the queue.
  const retryable = status === 429 || status >= 500;
  return { ok: false, retryable, errorCode: `http_${status}`, errorMessage: sanitize(text) };
}
