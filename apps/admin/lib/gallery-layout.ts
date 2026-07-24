// The product-page gallery layouts (stores.product_gallery_layout). Client-safe (no "use server"),
// so both the server action and the Tema picker can share the one list + type.
export const GALLERY_LAYOUTS = ["thumbnail-left", "thumbnail-bottom", "grid"] as const;
export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number];
