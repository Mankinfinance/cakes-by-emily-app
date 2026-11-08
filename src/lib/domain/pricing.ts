// Price calculation. The server always recalculates from the catalogue; the
// builder uses the same function only to show a live total.

import { percentOfRoundedDollar } from "./money";
import type {
  CakeConfig,
  CatalogueItem,
  PriceBreakdown,
  PriceLine,
  Settings,
} from "./types";

export interface PriceOptions {
  isRush: boolean;
  peakSurchargeCents: number;
  peakLabel?: string;
  /** A referral discount for a new customer (phase 3). */
  referralDiscountCents?: number;
  /** A stamp card reward to add as a free line (phase 3). */
  stampRewardName?: string;
}

export class PricingError extends Error {}

export function priceCake(
  config: CakeConfig,
  items: CatalogueItem[],
  settings: Settings,
  opts: PriceOptions,
): PriceBreakdown {
  const byId = new Map(items.map((i) => [i.id, i]));
  const need = (id: string, label: string): CatalogueItem => {
    const item = byId.get(id);
    if (!item) throw new PricingError(`Please choose a ${label}.`);
    return item;
  };

  const size = need(config.size, "size");
  if (size.category !== "size") throw new PricingError("Please choose a size.");
  const tiers = Math.max(1, size.tiers);

  const lines: PriceLine[] = [];
  const add = (item: CatalogueItem) => {
    const amount = item.priceMode === "per_tier" ? item.priceCents * tiers : item.priceCents;
    lines.push({ itemId: item.id, category: item.category, name: item.name, amountCents: amount });
  };

  const single: [keyof CakeConfig, CatalogueItem["category"]][] = [
    ["occasion", "occasion"],
    ["size", "size"],
    ["flavour", "flavour"],
    ["finish", "finish"],
    ["colour", "colour"],
  ];
  for (const [key, category] of single) {
    const item = need(config[key] as string, category);
    if (item.category !== category) throw new PricingError(`Please choose a ${category}.`);
    add(item);
  }
  for (const id of config.decorations) {
    const item = need(id, "decoration");
    if (item.category !== "decoration") throw new PricingError("Unknown decoration.");
    add(item);
  }
  for (const id of config.extras) {
    const item = need(id, "extra");
    if (item.category !== "extra") throw new PricingError("Unknown extra.");
    add(item);
  }
  let bondCents = 0;
  for (const id of config.addons ?? []) {
    const item = need(id, "add-on");
    if (item.category !== "addon") throw new PricingError("Unknown add-on.");
    add(item);
    bondCents += item.bondCents;
  }
  if (opts.stampRewardName) {
    lines.push({ itemId: null, category: "reward", name: `Stamp card reward: ${opts.stampRewardName}`, amountCents: 0 });
  }

  const subtotalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const rushFeeCents = opts.isRush ? settings.rushFeeCents : 0;
  const peakSurchargeCents = Math.max(0, opts.peakSurchargeCents);
  if (rushFeeCents) {
    lines.push({ itemId: null, category: "rush", name: "Rush order fee", amountCents: rushFeeCents });
  }
  if (peakSurchargeCents) {
    lines.push({
      itemId: null,
      category: "peak",
      name: opts.peakLabel ? `Peak date: ${opts.peakLabel}` : "Peak date surcharge",
      amountCents: peakSurchargeCents,
    });
  }
  if (bondCents) {
    lines.push({ itemId: null, category: "bond", name: "Refundable bond (stand hire)", amountCents: bondCents });
  }
  const beforeDiscount = subtotalCents + rushFeeCents + peakSurchargeCents + bondCents;
  const referralDiscountCents = Math.min(beforeDiscount, Math.max(0, opts.referralDiscountCents ?? 0));
  if (referralDiscountCents) {
    lines.push({ itemId: null, category: "referral", name: "Referral discount", amountCents: -referralDiscountCents });
  }
  const totalCents = beforeDiscount - referralDiscountCents;
  // Rush orders are paid in full; otherwise a deposit secures the date.
  const depositCents = opts.isRush
    ? totalCents
    : Math.min(totalCents, percentOfRoundedDollar(totalCents, settings.depositPercent));

  return {
    lines,
    subtotalCents,
    rushFeeCents,
    peakSurchargeCents,
    bondCents,
    referralDiscountCents,
    totalCents,
    depositCents,
    isRush: opts.isRush,
  };
}

/** What is still owed, after cash paid and any voucher or credit code used. */
export function balanceOwing(order: { totalCents: number; amountPaidCents: number; voucherAppliedCents?: number }): number {
  return Math.max(0, order.totalCents - order.amountPaidCents - (order.voucherAppliedCents ?? 0));
}

/** What the customer pays at checkout once a voucher or credit has been taken off the deposit. */
export function dueAtCheckout(depositCents: number, voucherAppliedCents: number): number {
  return Math.max(0, depositCents - voucherAppliedCents);
}
