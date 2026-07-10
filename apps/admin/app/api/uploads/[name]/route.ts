import { promises as fs } from "node:fs";
import path from "node:path";

// Serve runtime-uploaded media. `next start` only serves files that were in public/ AT BUILD TIME,
// so images uploaded after the build (public/uploads/) 404 via the static handler — this route
// streams them from disk instead. Public (no auth) so the storefront can show product images.
export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const TYPES: Record<string, string> = { webp: "image/webp", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif" };

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return new Response("bad request", { status: 400 }); // no path traversal
  try {
    const buf = await fs.readFile(path.join(UPLOAD_DIR, name));
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
