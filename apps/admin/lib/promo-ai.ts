import "server-only";
import { execFile } from "node:child_process";
import type { PromoContent } from "@/lib/data/promo";

// Claude-generated direct-response sales copy for a single-product COD landing. Called from the
// generatePromoContent action; the draft is handed to the editor, never auto-saved.
//
// Uses the local **Claude Code CLI** (`claude -p`), NOT the Anthropic API — no API key to store, the
// CLI carries its own auth. Server-only, and `execFile` (args array, no shell) so a product name with
// shell metacharacters can never be interpreted as a command.
//
// ⚠️ This depends on the `claude` binary being on the server's PATH. That is true on the dev box and
// wherever the CLI is installed; a plain VPS without it degrades gracefully ("Claude CLI tidak
// ditemukan"), same posture as the missing-KiriminAja-key path.

type ProductInput = { name: string; description: string; category: string; priceIdr: number };
export type GeneratedDraft = {
  headline?: string;
  subheadline?: string;
  badge?: string;
  benefits?: string[];
  idealFor?: string[];
  content?: PromoContent;
};

const IDR = (n: number) => "Rp" + Number(n || 0).toLocaleString("id-ID");

function buildPrompt(p: ProductInput): string {
  return `Kamu copywriter direct-response berbahasa Indonesia. Buat teks untuk SATU halaman pesanan (landing COD) untuk produk berikut. Gaya persuasif, jujur, hangat, khas UMKM Indonesia — problem → agitasi → solusi. JANGAN mengklaim hal medis/berlebihan yang tidak didukung deskripsi.

PRODUK:
- Nama: ${p.name}
- Kategori: ${p.category || "-"}
- Harga: ${IDR(p.priceIdr)}
- Deskripsi: ${p.description || "(tidak ada)"}

Balas HANYA dengan satu objek JSON valid (tanpa penjelasan, tanpa markdown), skema:
{
  "badge": "label pill pendek huruf kapital, maks 5 kata",
  "headline": "judul utama yang menarik, 6-12 kata",
  "subheadline": "1-2 kalimat framing masalah/janji",
  "problemTitle": "judul bagian masalah, 4-8 kata",
  "problemBullets": ["3-4 gejala/masalah nyata yang dirasakan calon pembeli, tiap item 1 kalimat"],
  "agitation": "1-2 kalimat memperbesar konsekuensi bila masalah dibiarkan",
  "solutionTitle": "judul bagian solusi, 5-10 kata",
  "solutionBody": "2-3 kalimat bagaimana produk ini menyelesaikannya",
  "benefits": ["3-5 manfaat utama, tiap item singkat"],
  "idealFor": ["3-6 kata/frasa siapa/kapan produk ini ideal, tiap item 1-2 kata"],
  "guarantee": "1 kalimat jaminan/kepercayaan (mis. produk original, dilayani admin resmi)"
}`;
}

/** Run `claude -p <prompt> --output-format json` and return its stdout, or an error. */
function runClaude(prompt: string): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    execFile(
      "claude",
      ["-p", prompt, "--output-format", "json"],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean };
          if (e.code === "ENOENT") return resolve({ ok: false, error: "Claude CLI tidak ditemukan di server." });
          if (e.killed) return resolve({ ok: false, error: "Generate memakan waktu terlalu lama. Coba lagi." });
          return resolve({ ok: false, error: "Claude CLI gagal dijalankan." });
        }
        resolve({ ok: true, stdout });
      },
    );
  });
}

/** Pull the model's answer text out of the CLI's JSON envelope (`{result: "..."}`), or use it raw. */
function resultText(stdout: string): string {
  try {
    const env = JSON.parse(stdout);
    if (env && typeof env.result === "string") return env.result;
  } catch {
    /* not the JSON envelope — treat stdout as the text itself */
  }
  return stdout;
}

/** Extract the first JSON object from the answer (handles ```json fences and stray prose). */
function parseJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function generateLandingCopy(p: ProductInput): Promise<{ ok: true; draft: GeneratedDraft } | { ok: false; error: string }> {
  const run = await runClaude(buildPrompt(p));
  if (!run.ok) return run;

  const obj = parseJson(resultText(run.stdout));
  if (!obj) return { ok: false, error: "Balasan AI tidak bisa dibaca. Coba lagi." };

  const s = (k: string) => (typeof obj[k] === "string" ? (obj[k] as string) : undefined);
  const arr = (k: string) => (Array.isArray(obj[k]) ? (obj[k] as unknown[]).map(String) : undefined);
  return {
    ok: true,
    draft: {
      headline: s("headline"),
      subheadline: s("subheadline"),
      badge: s("badge"),
      benefits: arr("benefits"),
      idealFor: arr("idealFor"),
      content: {
        problemTitle: s("problemTitle"),
        problemBullets: arr("problemBullets"),
        agitation: s("agitation"),
        solutionTitle: s("solutionTitle"),
        solutionBody: s("solutionBody"),
        guarantee: s("guarantee"),
      },
    },
  };
}
