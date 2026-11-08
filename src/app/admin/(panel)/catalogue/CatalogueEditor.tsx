"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ALLERGENS, CATEGORIES, type Allergen, type CatalogueItem, type Category } from "@/lib/domain/types";
import { addItemAction, updateItemAction } from "../actions";

const TITLES: Record<Category, string> = {
  occasion: "Occasions",
  size: "Sizes",
  flavour: "Flavours",
  finish: "Finishes (charged per tier)",
  colour: "Colours",
  decoration: "Decorations",
  extra: "Extras",
  addon: "Party add-ons (offered at checkout)",
};

function toCents(dollars: string): number | null {
  const n = Number(dollars);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function Row({ item, onError }: { item: CatalogueItem; onError: (msg: string | null) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState((item.priceCents / 100).toString());
  const [allergens, setAllergens] = useState<Allergen[]>(item.allergens);
  const [visible, setVisible] = useState(item.visible);
  const dirty = name !== item.name || toCents(price) !== item.priceCents || allergens.join() !== item.allergens.join();

  function save(patch: Record<string, unknown>) {
    start(async () => {
      const r = await updateItemAction(item.id, patch);
      onError(r.ok ? null : r.error);
      if (!r.ok && typeof patch.visible === "boolean") setVisible(!patch.visible);
      router.refresh();
    });
  }

  return (
    <li className={`grid gap-3 border-b border-line py-3 last:border-0 md:grid-cols-[1fr_120px_auto] md:items-start ${visible ? "" : "opacity-60"}`} data-testid={`item-${item.id}`}>
      <div className="min-w-0">
        <input className="field !py-2" value={name} onChange={(e) => setName(e.target.value)} aria-label={`Name for ${item.name}`} />
        <div className="mt-2 flex flex-wrap gap-1">
          {ALLERGENS.map((a) => (
            <button
              key={a}
              type="button"
              className="chip !px-2 !py-0.5 text-xs capitalize"
              aria-pressed={allergens.includes(a)}
              onClick={() => setAllergens(allergens.includes(a) ? allergens.filter((x) => x !== a) : [...allergens, a])}
            >
              {a}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-1">
        <span className="text-muted">$</span>
        <input className="field !py-2" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label={`Price for ${item.name}`} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={visible}
            disabled={pending}
            onChange={(e) => {
              setVisible(e.target.checked);
              save({ visible: e.target.checked });
            }}
            data-testid={`visible-${item.id}`}
          />
          Show to customers
        </label>
        {!visible && <span className="rounded-full bg-blush px-2 py-0.5 text-xs font-semibold">Hidden</span>}
        <button
          type="button"
          className="btn btn-primary !px-4 !py-1.5 text-sm"
          disabled={!dirty || pending || toCents(price) === null}
          onClick={() => save({ name, priceCents: toCents(price), allergens })}
        >
          Save
        </button>
      </div>
    </li>
  );
}

export function CatalogueEditor({ items }: { items: CatalogueItem[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [newItem, setNewItem] = useState<{ category: Category; name: string; price: string }>({ category: "flavour", name: "", price: "0" });

  return (
    <div className="mt-6 grid gap-6">
      {error && (
        <p className="sticky top-2 z-10 rounded-xl border border-rose bg-white px-4 py-3 text-sm text-rose-dark" role="alert" data-testid="catalogue-error">
          {error}
        </p>
      )}
      {CATEGORIES.map((cat) => {
        const list = items.filter((i) => i.category === cat);
        const hidden = list.filter((i) => !i.visible).length;
        return (
          <section key={cat} className="card p-5">
            <h2 className="font-serif text-xl">
              {TITLES[cat]} {hidden > 0 && <span className="text-sm font-normal text-muted">({hidden} hidden)</span>}
            </h2>
            <ul className="mt-2">
              {list.map((i) => (
                <Row key={`${i.id}-${i.priceCents}-${i.name}-${i.allergens.join()}-${i.visible}`} item={i} onError={setError} />
              ))}
            </ul>
          </section>
        );
      })}
      <section className="card p-5">
        <h2 className="font-serif text-xl">Add an item</h2>
        <p className="text-sm text-muted">New items start hidden so you can check them before customers see them.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr_120px_auto]">
          <select className="field" value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value as Category })} aria-label="Category">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TITLES[c].split(" (")[0]}
              </option>
            ))}
          </select>
          <input className="field" placeholder="Name" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} aria-label="New item name" />
          <input className="field" inputMode="decimal" value={newItem.price} onChange={(e) => setNewItem({ ...newItem, price: e.target.value })} aria-label="New item price in dollars" />
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || !newItem.name.trim() || toCents(newItem.price) === null}
            onClick={() =>
              start(async () => {
                const r = await addItemAction({ category: newItem.category, name: newItem.name, priceCents: toCents(newItem.price) });
                setError(r.ok ? null : r.error);
                if (r.ok) setNewItem({ ...newItem, name: "", price: "0" });
                router.refresh();
              })
            }
          >
            Add
          </button>
        </div>
      </section>
    </div>
  );
}
