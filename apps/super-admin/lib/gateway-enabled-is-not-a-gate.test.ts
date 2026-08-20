import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// ⚪ `platform_payment_gateways.enabled` IS A RECORD, NOT A SWITCH (owner ruling, 2026-08-20).
//
// Nothing on any payment path reads it. `/api/public/order` and `lib/actions/payments.ts` gate on
// `autolarisConfigured()` (the env key) ∧ `platform_payment_channels.enabled`. Its ONE consumer was
// an "Aktif" badge on the super-admin settings screen, driven by `autoGateway?.on` — so the control
// plane could show a green light over a PSP that cannot take a single rupiah, and could go dark
// while payments kept flowing. There was no Switch for it either: a status light wired to nothing.
//
// The column is kept rather than dropped (dropping is a destructive migration), the same standing as
// `store_settings.payment_channels`. What is pinned here is that nobody rebuilds a status light on
// it. If a platform-wide PSP kill-switch is ever wanted, it must be ENFORCED at the two payment
// paths first — the way `platform_cod.enabled` is — and only then surfaced; this test is what has to
// be rewritten then, deliberately.
//
// A source guard because the claim is about the ABSENCE of markup: there is nothing to import and
// call, and no type checker has an opinion about a badge that is gone. Read as CODE, so the long
// comment the screen now carries — which names `autoGateway?.on` in prose — cannot keep it green.

const SCREEN = codeOnly(
  readFileSync(new URL("../app/(platform)/pengaturan/pengaturan-client.tsx", import.meta.url), "utf8"),
);

/** A JSX conditional rendering anything off the AutoLaris gateway's `on` flag. */
const rendersOffTheFlag = (code: string) =>
  /autoGateway\s*\?\.\s*on\s*&&/.test(code) || /autoGateway\s*\?\.\s*on\s*\?/.test(code);

describe("no status light is built on platform_payment_gateways.enabled", () => {
  it("the settings screen renders nothing off autoGateway.on", () => {
    expect(rendersOffTheFlag(SCREEN)).toBe(false);
  });

  // Proves the predicate can fire. A source guard nobody has seen red is green for reasons nobody
  // has checked — this repo has made that mistake nine times over comment-vs-code alone.
  it("goes red if the badge is put back", () => {
    const reverted = codeOnly(
      readFileSync(new URL("../app/(platform)/pengaturan/pengaturan-client.tsx", import.meta.url), "utf8")
        .replace(
          '<div className="flex shrink-0 items-center gap-2">',
          '<div className="flex shrink-0 items-center gap-2">{autoGateway?.on && (<Badge>Aktif</Badge>)}',
        ),
    );
    expect(rendersOffTheFlag(reverted)).toBe(true);
  });

  // The banner keeps the ENFORCED fact — how many channels checkout will actually offer. Removing a
  // false signal must not quietly remove the true one beside it.
  it("the channel counter, which IS enforced, stays", () => {
    expect(SCREEN).toMatch(/activeChannels/);
  });
});
