import { newLandingEditor } from "@/lib/data/landing";
import { LandingEditorClient } from "../[id]/landing-editor-client";

export const dynamic = "force-dynamic";

// The create door for the custom-HTML landing feature (N54). `/promo` linked here from the day the
// feature shipped, but `promo/html/` held only `[id]`, whose page 404s anything that is not a UUID —
// so "Buat baru" was a 404 and NO landing could ever be created through the UI. Existing rows edited
// fine, which is why it survived review.
//
// A STATIC segment, not a loosened guard: Next matches `baru/` before `[id]/`, so `isUuid` stays
// exactly as strict as it is (Postgres throws `22P02` on a non-UUID — a 500 where a 404 belongs).
// The same editor renders the draft; `saveLanding` INSERTs when it is handed no id and the client
// then routes to `/promo/html/<new id>`, so nothing is written before Simpan.
export default async function NewLandingPage() {
  return <LandingEditorClient editor={await newLandingEditor()} />;
}
