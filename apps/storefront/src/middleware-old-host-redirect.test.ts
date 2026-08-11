import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// The slug-rename 301 must carry the PORT of the host it is leaving.
//
// `normalizeHost` strips the port before the redirect target is built, so the Location for
// `batik-nusantara.127.0.0.1.sslip.io:4327` used to point at the portless host — a redirect into
// nothing, in exactly the environment (dev, sslip form) that carries a port. Prod hosts carry none,
// so there the port token is "" and the Location is byte-identical to before the fix.
// Audit: specs/docs/tasks/2026-08-12-postship-audit.md, D4.
//
// A source claim, not a behavioral one: the middleware imports `astro:middleware` (a virtual
// module), and stubbing that lives in the shared vitest config, which this change set does not own
// — the behavioral pin is the audit's still-open D2. This file pins the SHAPE: the port is derived
// from the RAW host (the normalized one cannot yield it) and emitted between host and path.

const src = readFileSync(new URL("./middleware.ts", import.meta.url), "utf8");
const code = codeOnly(src);

// codeOnly inerts literal contents (the regex literal and the template's quoted runs), but the
// EXPRESSIONS interpolated into the Location template survive as tokens in order — which is the
// whole claim: scheme, newHost, port, pathname, search.
const LOCATION_WITH_PORT =
  /Response\s*\.\s*redirect\s*\([\s\S]{0,120}?newHost[\s\S]{0,40}?port[\s\S]{0,40}?context\s*\.\s*url\s*\.\s*pathname/;
const PORT_FROM_RAW_HOST = /exec\s*\(\s*rawHost/;

describe("old-host 301 keeps the port", () => {
  it("derives the port from the RAW host and emits it in the Location", () => {
    expect(code).toMatch(PORT_FROM_RAW_HOST);
    expect(code).toMatch(LOCATION_WITH_PORT);
  });

  it("fires on the shipped port-dropping shape (mutation self-check)", () => {
    // Put the bug back on a COPY: no port binding, Location built host-then-path.
    const reverted = codeOnly(
      src
        .replace(/\n\s*const port = [^\n]+\n/, "\n")
        .replace("${newHost}${port}", "${newHost}"),
    );
    expect(reverted).not.toMatch(PORT_FROM_RAW_HOST);
    expect(reverted).not.toMatch(LOCATION_WITH_PORT);
  });
});
