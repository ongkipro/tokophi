import "server-only";
import type { PromoContent } from "@/lib/data/promo";

// Claude-generated direct-response sales copy for a single-product COD landing. Called from the
// generatePromoContent action; the draft is handed to the editor, never auto-saved.
//
// 🔴 IT USED TO `execFile("claude", …)` — THE CLI, WHICH EXISTS ON A DEVELOPER'S LAPTOP AND NOT IN
// THE PRODUCTION CONTAINER (Task 8.7). The feature therefore READ as implemented — a Generate
// button, a prompt builder, an output parser, a toast — while every press in production came back
// "Claude CLI tidak ditemukan di server." for as long as the button has existed. A shipped control
// whose only possible outcome is an error message is not a degraded feature, it is a dead one; the
// old comment here called the missing binary "graceful degradation", which is the sentence that let
// it sit. There is no `child_process` on this path any more, and `promo-ai.test.ts` fails if one
// comes back.
//
// It is a plain `fetch` to the Anthropic Messages API — no SDK dependency added for one POST, which
// is the repo's standing rule about new deps. The key comes from the environment and NOTHING else;
// it is never logged, never returned to the client, and never rendered.
//
// ⚠️ WITH THE KEY UNSET THE FEATURE IS OFF, NOT BROKEN. `promoAiEnabled()` is the one answer, the
// editor hides the button behind it and says why in Indonesian, and this module still refuses
// server-side — the UI is the courtesy, this is the boundary. Same posture as `googleEnabled()`.
// Read at CALL TIME: a module-scope read gets baked in at build time, when the env is empty.

const MODEL = "claude-opus-5";
const API = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const TIMEOUT_MS = 120_000;

type ProductInput = { name: string; description: string; category: string; priceIdr: number };
export type GeneratedDraft = {
  headline?: string;
  subheadline?: string;
  badge?: string;
  benefits?: string[];
  idealFor?: string[];
  content?: PromoContent;
};

/** The single source of "may this feature run at all?". Read by the editor page and by the action. */
export function promoAiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/** Shown wherever the feature is off. One sentence, Indonesian, says what is missing and to whom. */
export const PROMO_AI_DISABLED_ID = "Generate AI belum aktif — kunci API belum dipasang di server. Hubungi admin TokoΦ.";

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

/**
 * POST the prompt and return the model's answer text.
 *
 * ⚠️ THE PROVIDER'S OWN ERROR TEXT NEVER REACHES THE MERCHANT — the same rule the public routes
 * carry (ADR 0004). An Anthropic 401/429 body is written by someone else, is unbounded, and can name
 * the vendor and the account; it goes to `console.error` and the merchant gets one of ours.
 * ⚠️ And the key is not in the message either: the status code is, the response body is not.
 */
async function askClaude(prompt: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return { ok: false, error: PROMO_AI_DISABLED_ID };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        // Copywriting from four short fields is routine work; `low` is the cheap end of the same
        // model rather than a weaker one. Thinking is on by default on this model — leave it there.
        output_config: { effort: "low" },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error("[promo-ai] Anthropic HTTP", res.status, await res.text().catch(() => ""));
      return { ok: false, error: "Layanan AI sedang tidak bisa dihubungi. Coba lagi sebentar lagi." };
    }

    const body = (await res.json()) as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string }>;
    };
    // A safety decline is HTTP 200 with `stop_reason: "refusal"` and no usable text — check it
    // BEFORE reading content, or the merchant gets "tidak bisa dibaca" for a refusal.
    if (body.stop_reason === "refusal") {
      return { ok: false, error: "AI menolak membuat teks untuk produk ini. Coba perbaiki deskripsi produknya." };
    }
    // `content` is a list of blocks; with thinking on, the answer is not block 0.
    const text = (body.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n")
      .trim();
    if (!text) return { ok: false, error: "Balasan AI kosong. Coba lagi." };
    return { ok: true, text };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return { ok: false, error: "Generate memakan waktu terlalu lama. Coba lagi." };
    console.error("[promo-ai] fetch failed", e);
    return { ok: false, error: "Layanan AI sedang tidak bisa dihubungi. Coba lagi sebentar lagi." };
  } finally {
    clearTimeout(timer);
  }
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
  const run = await askClaude(buildPrompt(p));
  if (!run.ok) return run;

  const obj = parseJson(run.text);
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
