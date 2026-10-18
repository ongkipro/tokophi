// Kecamatan search for the address form (signed-in only). Reference data through the ONE shared
// implementation (`@tokophi/lib/area-search`), so a district reads the same here as at checkout.
import type { APIRoute } from "astro";
import { db } from "@tokophi/db";
import { searchAreas } from "@tokophi/lib/area-search";
import { areaTerm } from "../../data/addresses";

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.account) return new Response(null, { status: 401 });
  const q = areaTerm(url.searchParams.get("q") ?? "");
  const areas = q.length >= 3 ? await searchAreas(db, q, 8) : [];
  return Response.json(areas.map((a) => ({ id: a.id, text: a.text })));
};
