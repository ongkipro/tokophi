import { ChevronDown } from "lucide-react";
import type { FaqConfig } from "@tokophi/sections";

// Editor preview. Mirrors the storefront's geometry (centred heading, hairline-divided rows inside a
// max-w-3xl column) so the merchant recognises the block. Rows render OPEN here on purpose: in the
// builder you are editing the answers, and a closed disclosure would hide the very text being typed.
// The storefront renders them closed, via native <details>.
export function Faq({ heading, eyebrow, items }: FaqConfig) {
  const rows = (items ?? []).filter((i) => i.question?.trim());

  return (
    <section className="p-6">
      {heading && (
        <div className="mb-6 text-center">
          {eyebrow && <p className="text-xs font-medium tracking-wide text-brand-600 uppercase">{eyebrow}</p>}
          <h2 className="mt-1 text-xl font-semibold text-ink">{heading}</h2>
        </div>
      )}

      {rows.length === 0 ? (
        // Says what will happen rather than showing an empty frame — the section renders NOTHING on
        // the storefront until there is at least one question.
        <p className="rounded-md border border-dashed border-ink/15 p-6 text-center text-sm text-ink/50">
          Belum ada pertanyaan. Tambahkan minimal satu — section ini tidak tampil di storefront selama masih kosong.
        </p>
      ) : (
        <div className="mx-auto max-w-2xl divide-y divide-ink/10 border-y border-ink/10">
          {rows.map((row, i) => (
            <div key={i} className="py-4">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium text-ink">{row.question}</span>
                <ChevronDown className="size-4 shrink-0 text-ink/40" aria-hidden="true" />
              </div>
              {row.answer?.trim() && (
                <p className="mt-2 text-sm whitespace-pre-line text-ink/60">{row.answer}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
