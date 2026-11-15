// Container healthcheck (docker-compose.coolify.yml `affiliate`). Answers whether the area is open or
// closed — Traefik routes only to a HEALTHY container, so a closed area must still be healthy to show its
// "belum dibuka" page. It proves the process serves AND reaches Postgres; it reads no row.
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
