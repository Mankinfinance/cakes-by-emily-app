// "Show to customers" rules. Hidden items vanish from the builder but stay on
// existing orders, because orders keep a snapshot of their items.

import {
  type CakeConfig,
  type CatalogueItem,
  type Category,
  type DietaryFilter,
  DIETARY_FILTERS,
  REQUIRED_CATEGORIES,
} from "./types";

export function visibleItems(items: CatalogueItem[]): CatalogueItem[] {
  return items.filter((i) => i.visible).sort((a, b) => a.sort - b.sort);
}

export function itemsIn(items: CatalogueItem[], category: Category): CatalogueItem[] {
  return items.filter((i) => i.category === category).sort((a, b) => a.sort - b.sort);
}

export type VisibilityCheck = { ok: true } | { ok: false; reason: string };

/**
 * Can this item's visibility be set to `visible`? Hiding the last visible
 * option in a required step would make the builder impossible to finish.
 */
export function canSetVisibility(
  items: CatalogueItem[],
  itemId: string,
  visible: boolean,
): VisibilityCheck {
  const item = items.find((i) => i.id === itemId);
  if (!item) return { ok: false, reason: "That item no longer exists." };
  if (visible || !item.visible) return { ok: true };
  if (!REQUIRED_CATEGORIES.includes(item.category)) return { ok: true };
  const othersVisible = items.filter(
    (i) => i.category === item.category && i.visible && i.id !== itemId,
  ).length;
  if (othersVisible === 0) {
    return { ok: false, reason: `Keep at least one ${categoryNoun(item.category)} visible.` };
  }
  return { ok: true };
}

export function categoryNoun(category: Category): string {
  const nouns: Record<Category, string> = {
    occasion: "occasion",
    size: "size",
    flavour: "flavour",
    finish: "finish",
    colour: "colour",
    decoration: "decoration",
    extra: "extra",
    addon: "add-on",
  };
  return nouns[category];
}

/** Does the item clash with any of the chosen dietary filters? */
export function clashesWith(item: CatalogueItem, filters: DietaryFilter[]): string | null {
  for (const f of filters) {
    for (const allergen of DIETARY_FILTERS[f].excludes) {
      if (item.allergens.includes(allergen)) return `contains ${allergen}`;
    }
  }
  return null;
}

export interface SanitizeResult {
  config: CakeConfig;
  removed: string[];
}

/**
 * Drop anything hidden, unknown or clashing from a config and fall back to
 * the first allowed option in each required step.
 */
export function sanitizeConfig(
  config: CakeConfig,
  items: CatalogueItem[],
  filters: DietaryFilter[] = [],
): SanitizeResult {
  const removed: string[] = [];
  const allowed = (cat: Category) =>
    visibleItems(items).filter((i) => i.category === cat && !clashesWith(i, filters));

  const pickOne = (cat: Category, current: string): string => {
    const options = allowed(cat);
    if (options.some((o) => o.id === current)) return current;
    if (current) {
      const name = items.find((i) => i.id === current)?.name;
      if (name) removed.push(name);
    }
    return options[0]?.id ?? "";
  };

  const pickMany = (cat: Category, current: string[]): string[] => {
    const ids = new Set(allowed(cat).map((o) => o.id));
    return current.filter((id) => {
      if (ids.has(id)) return true;
      const name = items.find((i) => i.id === id)?.name;
      if (name) removed.push(name);
      return false;
    });
  };

  return {
    config: {
      occasion: pickOne("occasion", config.occasion),
      size: pickOne("size", config.size),
      flavour: pickOne("flavour", config.flavour),
      finish: pickOne("finish", config.finish),
      colour: pickOne("colour", config.colour),
      decorations: pickMany("decoration", [...new Set(config.decorations)]),
      extras: pickMany("extra", [...new Set(config.extras)]),
      addons: pickMany("addon", [...new Set(config.addons ?? [])]),
      topperText: config.topperText.trim().slice(0, 30),
    },
    removed,
  };
}

export function emptyConfig(items: CatalogueItem[]): CakeConfig {
  return sanitizeConfig(
    {
      occasion: "",
      size: "",
      flavour: "",
      finish: "",
      colour: "",
      decorations: [],
      extras: [],
      topperText: "",
    },
    items,
  ).config;
}
