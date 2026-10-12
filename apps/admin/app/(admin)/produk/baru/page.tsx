import { getCategoryOptions } from "@/lib/data/products";
import { ProductEditor } from "../[id]/product-editor";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  return <ProductEditor categoryOptions={await getCategoryOptions()} />;
}
