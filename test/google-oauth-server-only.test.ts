import { describe, expect, it } from "vitest";
import { isTestFile, textOfFile, trackedSources } from "./source-code";

// `@tokophi/lib/google-oauth` returns the Google client SECRET from `googleConfig()`. When it lived in
// `apps/admin/lib/google.ts` an `import "server-only"` stopped a client component from bundling it;
// the shared package serves Astro too and cannot carry that marker, so this sweep is the guard.
describe("google-oauth never reaches a client bundle", () => {
  it("no \"use client\" file imports it", () => {
    const offenders = trackedSources()
      .filter((rel) => !isTestFile(rel))
      .filter((rel) => {
        const t = textOfFile(rel);
        return /^\s*["']use client["']/.test(t) && /@tokophi\/lib\/google-oauth/.test(t);
      });
    expect(offenders).toEqual([]);
  });
});
