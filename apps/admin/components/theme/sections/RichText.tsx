import type { RichTextConfig } from "@tokophi/sections";

export function RichText({ heading, body, ctaLabel, ctaHref, theme }: RichTextConfig) {
  const dark = theme === "gelap";
  return (
    <section
      className={`rounded-2xl p-10 text-center ${dark ? "bg-stone-900 text-white" : "bg-stone-50 text-stone-900"}`}
    >
      <h2 className="mx-auto max-w-xl text-2xl font-semibold">{heading}</h2>
      <p className={`mx-auto mt-3 max-w-md ${dark ? "text-white/75" : "text-stone-600"}`}>{body}</p>
      {ctaLabel && (
        <a
          href={ctaHref}
          className={`mt-6 inline-flex rounded-full px-6 py-2.5 text-sm font-semibold shadow-sm transition ${
            dark ? "bg-white text-stone-900 hover:bg-white/90" : "bg-stone-900 text-white hover:bg-stone-800"
          }`}
        >
          {ctaLabel}
        </a>
      )}
    </section>
  );
}
