import { fillTemplate } from "@tokophi/lib/format";
import type { CartItem } from "@/lib/data/checkout";

// PURE — no `@tokophi/db` import, and that is deliberate.
//
// This lived in `lib/data/checkout.ts`, which pulls the Drizzle client at module scope, so importing
// it in a test demanded a DATABASE_URL for a function that only does string substitution. Same split
// the repo already uses for `platform-rank.ts` and `@tokophi/lib/password`, and for the same reason:
// the rule worth pinning was the one that could not be reached without standing up a database.

// ⚠️ THE LINK IS APPENDED WHEN THE TEMPLATE HAS NO `{{link}}`, AND THAT FALLBACK IS THE FEATURE.
//
// **The seed is not a migration** (AGENTS.md): the `{{link}}` placeholder added to `seed.ts` reaches
// NEW stores only — every store that already exists keeps the body it was given, which has no
// placeholder. If this only substituted `{{link}}`, the fix would ship and change nothing for a
// single live merchant, which is precisely the shape of the bug being closed here.
//
// So: substitute where the merchant has placed it, append where they have not. A merchant who wants
// the link mid-sentence writes `{{link}}` and gets it there; everyone else gets a working message
// today with no data fix and no edit.
export function cartMessage(
  templateBody: string,
  name: string | null,
  items: CartItem[],
  storeName: string,
  link: string | null = null,
): string {
  const produk = items.length > 1 ? `${items[0].name} +${items.length - 1} lainnya` : items[0]?.name ?? "produk pilihan Anda";
  const filled = fillTemplate(templateBody, { nama: name ?? "", produk, toko: storeName, link: link ?? "" });
  if (!link || templateBody.includes("{{link}}")) return filled;
  // Two newlines: WhatsApp renders the URL as its own tappable block with a preview card, rather than
  // running it into the sentence where a trailing "." can be swallowed into the link.
  return `${filled}\n\nLanjutkan pesanan di sini:\n${link}`;
}

