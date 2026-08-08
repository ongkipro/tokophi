import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The CNAME target for merchant custom domains is `cname.tokophi.cc` — Cloudflare-for-SaaS runs on the
// tokophi.cc zone. `apps/admin/lib/data/domain.ts` is the authority.
//
// This guard exists because the OLD value survived in FOUR documents plus a live compose default, and
// each fix only revealed the next copy. Trusting one of them cost a fallback origin and a custom
// hostname created in the wrong Cloudflare zone, and a merchant told to point DNS at a target that can
// never validate. A stale value that is merely "documented somewhere" gets followed.
//
// Files below are allowed to contain the old string BECAUSE THEY DESCRIBE THE MISTAKE. Everything else
// must not — including any new doc, example or default.
//
// ⚠️ These files are allowlisted, NOT stale. Rewriting them would destroy the record: a blanket
// find-and-replace on 2026-08-08 turned a measured DNS result into a falsehood — the line
// `A cname.tokophi.com → 104.21.29.252 … DIFFERENT IPs` became `.cc`, which resolves to entirely
// different addresses that are in fact IDENTICAL to the merchant's. The correction notes must keep
// saying `.com`, because `.com` is what was wrong. **Never sweep a history file.**
const ALLOWED = new Set([
  "CHANGELOG.md", // immutable history
  "specs/docs/WORKLOG.md", // session records — what was done, when
  "specs/docs/CUSTOM_DOMAIN.md", // carries the superseded-value banner
  "specs/docs/DEPLOY.md", // annotates the entry that was right and unread
  "specs/docs/tasks/2026-08-06-open-work.md", // DOM-2 retraction + the measured DNS comparison
  "specs/docs/tasks/2026-08-07-handoff-session.md", // records what was built in the wrong zone
  ".env.coolify.example", // comment records what the default used to be
  "docker-compose.coolify.yml", // same, on the live default
  "test/cname-target.test.ts", // this file
]);

const OLD = ["cname", "tokophi", "com"].join("."); // assembled so the guard is not its own false positive

describe("the custom-domain CNAME target", () => {
  it(`only mentions ${OLD} in files that explain why it is wrong`, () => {
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
    const offenders = tracked.filter((f) => {
      if (ALLOWED.has(f)) return false;
      try {
        return readFileSync(f, "utf8").includes(OLD);
      } catch {
        return false; // binary or unreadable — not our concern
      }
    });
    expect(offenders).toEqual([]);
  });
});
