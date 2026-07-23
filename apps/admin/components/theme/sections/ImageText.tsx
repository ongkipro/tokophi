import type { ImageTextConfig } from "@tokophi/sections";

export function ImageText({ heading, body, imageUrl, imageSide, eyebrow }: ImageTextConfig) {
  const image = (
    <div className="aspect-[4/3] overflow-hidden rounded-3xl bg-gradient-to-br from-stone-300 to-stone-100 ring-1 ring-stone-200">
      {imageUrl && <img src={imageUrl} alt="" className="h-full w-full object-cover" />}
    </div>
  );
  const text = (
    <div className="flex flex-col justify-center gap-3">
      {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">{eyebrow}</p>}
      <h2 className="text-2xl font-semibold text-stone-900">{heading}</h2>
      <p className="text-stone-600">{body}</p>
    </div>
  );
  return (
    <section className="grid grid-cols-2 gap-8 p-6">
      {imageSide === "right" ? (
        <>
          {text}
          {image}
        </>
      ) : (
        <>
          {image}
          {text}
        </>
      )}
    </section>
  );
}
