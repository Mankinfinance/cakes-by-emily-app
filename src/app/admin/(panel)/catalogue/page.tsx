import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { CatalogueEditor } from "./CatalogueEditor";

export default async function CataloguePage() {
  await requireAdmin();
  const items = await (await getRepo()).listCatalogue();
  return (
    <div>
      <h1 className="font-serif text-3xl">Prices and menu</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Change prices and names, and untick &quot;Show to customers&quot; to hide anything from the cake builder. Hidden items stay on orders that
        already include them. Changes apply straight away.
      </p>
      <CatalogueEditor items={items} />
    </div>
  );
}
