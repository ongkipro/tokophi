// Container healthcheck (docker-compose.coolify.yml `account`). Answers whether the account is open or
// closed — Traefik routes only to a HEALTHY container, so a closed account must still be healthy to
// show its "belum dibuka" page. It proves the process serves AND reaches Postgres (the same bar as the
// storefront's `GET /`); it reads no row.
import type { APIRoute } from "astro";
import { db } from "@tokophi/db";
import { sql } from "drizzle-orm";

export const GET: APIRoute = async () => {
  try {
    await db.execute(sql`select 1`);
    return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
  } catch {
    return new Response("db unreachable", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
};
