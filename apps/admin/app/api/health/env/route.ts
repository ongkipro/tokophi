import { NextResponse, type NextRequest } from "next/server";
import { checkEnv } from "@/lib/env-health";
import { cronAuthorized } from "@/lib/cron-auth";

/**
 * "Did the environment actually reach this container?" — one request, after every deploy (N60).
 *
 * The failure it answers is written up in `lib/env-health.ts`: a value saved in Coolify four minutes
 * after a deployment started never reached the container, every host stayed healthy, and nothing
 * anywhere said so. This is the thing that says so.
 *
 * 🔴 NAMES AND PRESENCE ONLY — NEVER A VALUE. Half the list is credentials (`AUTH_SECRET`,
 * `KIRIMINAJA_API_KEY`, `AUTOLARIS_CALLBACK_SECRET`). Presence is what an operator needs; the value
 * is one screenshot away from being leaked. `apps/admin/lib/env-census.test.ts` fails if this route
 * ever reads `process.env` for anything other than its own gate.
 *
 * ⚠️ Gated on `CRON_SECRET`, exactly like the cron routes, and FAIL CLOSED in production: an unset
 * secret means NO, never "no gate". Even a list of names is a map of the surface for whoever asks.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req, "health/env")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { ok, missing, checks } = checkEnv();
  // 200 even when something is missing: this endpoint's job is to REPORT, and a non-200 would make
  // a shell check (`curl -f`) hide the very body that says which variable is gone. `ok` is the verdict.
  return NextResponse.json(
    {
      ok,
      missing,
      app: "admin",
      checks: checks.map((c) => ({ name: c.name, present: c.present, required: c.required, why: c.why })),
    },
    { status: 200 },
  );
}
