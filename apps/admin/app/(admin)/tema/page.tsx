import type { Data } from "@measured/puck";
import { DEFAULT_BRAND_COLOR } from "@tokophi/lib/colors";
import { getSession } from "@/lib/auth";
import { getDefaultHomepage, getBrandColor } from "@/lib/data/theme";
import { TemaClient } from "./tema-client";

export const dynamic = "force-dynamic";

const BLANK_DATA: Data = { content: [], root: {} };

export default async function TemaPage() {
  const session = await getSession();
  const [homepage, brandColor] = await Promise.all([
    getDefaultHomepage(),
    session ? getBrandColor(session.storeId) : Promise.resolve(null),
  ]);
  return (
    <TemaClient
      initialData={(homepage?.sections as Data | undefined) ?? BLANK_DATA}
      initialBrandColor={brandColor ?? DEFAULT_BRAND_COLOR}
    />
  );
}
