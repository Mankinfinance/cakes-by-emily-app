import { describe, expect, it } from "vitest";
import {
  buildLoad,
  checkBooking,
  dateStatus,
  emptyLoad,
  slotTimes,
  slotsFor,
  type CalendarContext,
} from "@/lib/domain/availability";
import {
  addDays,
  daysBetween,
  formatTime12,
  isIsoDate,
  monthDays,
  todayInBusinessTz,
  weekStart,
} from "@/lib/domain/dates";
import { formatAud, percentOfRoundedDollar } from "@/lib/domain/money";
import { balanceOwing, priceCake, PricingError } from "@/lib/domain/pricing";
import { nextStage, stageIndex } from "@/lib/domain/stages";
import type { CakeConfig, CatalogueItem, Settings } from "@/lib/domain/types";
import {
  canSetVisibility,
  clashesWith,
  emptyConfig,
  sanitizeConfig,
  visibleItems,
} from "@/lib/domain/visibility";
import { SAMPLE_CATALOGUE, SAMPLE_SETTINGS } from "@/lib/data/sample-data";

const items = (): CatalogueItem[] => SAMPLE_CATALOGUE.map((i) => ({ ...i, allergens: [...i.allergens] }));
const settings = (over: Partial<Settings> = {}): Settings => ({ ...SAMPLE_SETTINGS, ...over });

const baseConfig: CakeConfig = {
  occasion: "occ-birthday",
  size: "size-6-round",
  flavour: "fl-vanilla",
  finish: "fin-buttercream",
  colour: "col-blush",
  decorations: [],
  extras: [],
  topperText: "",
};

// Saturday 7 Nov 2026 is "today" in these tests. Mondays are closed by default.
const TODAY = "2026-11-07";
const ctx = (over: Partial<CalendarContext> = {}): CalendarContext => ({
  today: TODAY,
  settings: settings(),
  daysOff: [],
  peakDates: [],
  load: emptyLoad(),
  ...over,
});

describe("dates", () => {
  it("validates ISO dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
  });
  it("adds days across months and DST", () => {
    expect(addDays("2026-10-03", 2)).toBe("2026-10-05");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-11-07", "2026-11-14")).toBe(7);
  });
  it("finds the Monday of a week", () => {
    expect(weekStart("2026-11-08")).toBe("2026-11-02"); // Sunday
    expect(weekStart("2026-11-09")).toBe("2026-11-09"); // Monday
  });
  it("lists the days in a month", () => {
    expect(monthDays("2027-02")).toHaveLength(28);
  });
  it("uses Sydney time for today", () => {
    // 2026-11-07T14:30Z is 1:30am on 8 Nov in Sydney (AEDT, UTC+11).
    expect(todayInBusinessTz(new Date("2026-11-07T14:30:00Z"))).toBe("2026-11-08");
    expect(todayInBusinessTz(new Date("2026-11-07T12:00:00Z"))).toBe("2026-11-07");
  });
  it("formats 12 hour times", () => {
    expect(formatTime12("09:00")).toBe("9am");
    expect(formatTime12("13:30")).toBe("1:30pm");
    expect(formatTime12("00:00")).toBe("12am");
  });
});

describe("money", () => {
  it("formats AUD", () => {
    expect(formatAud(13000)).toBe("$130");
    expect(formatAud(12550)).toBe("$125.50");
  });
  it("rounds percentages to whole dollars", () => {
    expect(percentOfRoundedDollar(17500, 50)).toBe(8800);
    expect(percentOfRoundedDollar(13000, 50)).toBe(6500);
  });
});

describe("pricing", () => {
  it("prices a simple cake with a 50% deposit", () => {
    const p = priceCake(baseConfig, items(), settings(), { isRush: false, peakSurchargeCents: 0 });
    expect(p.subtotalCents).toBe(13000);
    expect(p.totalCents).toBe(13000);
    expect(p.depositCents).toBe(6500);
    expect(p.isRush).toBe(false);
  });
  it("charges finishes and premium flavours per tier", () => {
    const p = priceCake(
      { ...baseConfig, size: "size-two-tier", finish: "fin-painted", flavour: "fl-gf-vanilla" },
      items(),
      settings(),
      { isRush: false, peakSurchargeCents: 0 },
    );
    // 340 + 2 x 35 + 2 x 20
    expect(p.subtotalCents).toBe(34000 + 7000 + 4000);
  });
  it("adds decorations and extras once each", () => {
    const p = priceCake(
      { ...baseConfig, decorations: ["dec-gold-leaf", "dec-topper"], extras: ["ext-cupcakes"] },
      items(),
      settings(),
      { isRush: false, peakSurchargeCents: 0 },
    );
    expect(p.subtotalCents).toBe(13000 + 1500 + 2000 + 3000);
  });
  it("adds rush fee and takes full payment for rush orders", () => {
    const p = priceCake(baseConfig, items(), settings(), { isRush: true, peakSurchargeCents: 0 });
    expect(p.rushFeeCents).toBe(4000);
    expect(p.totalCents).toBe(17000);
    expect(p.depositCents).toBe(17000);
    expect(p.lines.at(-1)?.name).toBe("Rush order fee");
  });
  it("adds a peak surcharge line", () => {
    const p = priceCake(baseConfig, items(), settings(), {
      isRush: false,
      peakSurchargeCents: 3000,
      peakLabel: "Christmas Eve",
    });
    expect(p.totalCents).toBe(16000);
    expect(p.lines.some((l) => l.name === "Peak date: Christmas Eve")).toBe(true);
    expect(p.depositCents).toBe(8000);
  });
  it("rejects unknown or mismatched items", () => {
    expect(() =>
      priceCake({ ...baseConfig, size: "nope" }, items(), settings(), { isRush: false, peakSurchargeCents: 0 }),
    ).toThrow(PricingError);
    expect(() =>
      priceCake({ ...baseConfig, flavour: "size-8-round" }, items(), settings(), { isRush: false, peakSurchargeCents: 0 }),
    ).toThrow(PricingError);
    expect(() =>
      priceCake({ ...baseConfig, extras: ["dec-gold-leaf"] }, items(), settings(), { isRush: false, peakSurchargeCents: 0 }),
    ).toThrow(PricingError);
  });
  it("uses the price list it is given, so admin edits apply", () => {
    const list = items().map((i) => (i.id === "size-6-round" ? { ...i, priceCents: 15000 } : i));
    expect(priceCake(baseConfig, list, settings(), { isRush: false, peakSurchargeCents: 0 }).totalCents).toBe(15000);
  });
  it("works out the balance owing", () => {
    expect(balanceOwing({ totalCents: 13000, amountPaidCents: 6500 })).toBe(6500);
    expect(balanceOwing({ totalCents: 13000, amountPaidCents: 14000 })).toBe(0);
  });
});

describe("availability", () => {
  it("blocks past dates, today and closed weekdays", () => {
    expect(dateStatus("2026-11-06", ctx()).state).toBe("past");
    expect(dateStatus(TODAY, ctx()).state).toBe("past");
    expect(dateStatus("2026-11-16", ctx()).state).toBe("closed"); // Monday
  });
  it("offers rush inside the notice period", () => {
    expect(dateStatus("2026-11-08", ctx()).state).toBe("too_soon"); // 1 day, under rushMinDays
    const s = dateStatus("2026-11-10", ctx());
    expect(s.state).toBe("rush");
    expect(s.bookable).toBe(true);
    expect(s.isRush).toBe(true);
    expect(dateStatus("2026-11-14", ctx()).state).toBe("available"); // exactly 7 days
  });
  it("blocks rush when Emily turns it off", () => {
    expect(dateStatus("2026-11-10", ctx({ settings: settings({ rushEnabled: false }) })).state).toBe("too_soon");
  });
  it("blocks rush when the day is full", () => {
    const load = buildLoad([
      { pickupDate: "2026-11-10", pickupSlot: "09:00" },
      { pickupDate: "2026-11-10", pickupSlot: "09:30" },
      { pickupDate: "2026-11-10", pickupSlot: "10:00" },
    ]);
    expect(dateStatus("2026-11-10", ctx({ load })).state).toBe("full");
  });
  it("respects days off and the weekly cap", () => {
    expect(dateStatus("2026-11-20", ctx({ daysOff: [{ date: "2026-11-20", note: "" }] })).state).toBe("day_off");
    const many = Array.from({ length: 12 }, (_, i) => ({
      pickupDate: ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-21"][i % 4],
      pickupSlot: `1${i % 6}:00`,
    }));
    expect(dateStatus("2026-11-20", ctx({ load: buildLoad(many) })).state).toBe("full");
    expect(dateStatus("2026-11-24", ctx({ load: buildLoad(many) })).state).toBe("available");
  });
  it("marks peak dates and the booking horizon", () => {
    const s = dateStatus("2026-12-24", ctx({ peakDates: [{ date: "2026-12-24", label: "Christmas Eve", surchargeCents: 3000 }] }));
    expect(s.peak?.surchargeCents).toBe(3000);
    expect(s.bookable).toBe(true);
    expect(dateStatus("2027-12-01", ctx()).state).toBe("beyond_horizon");
  });
  it("builds 30 minute slots with caps", () => {
    const times = slotTimes(settings());
    expect(times[0]).toBe("09:00");
    expect(times.at(-1)).toBe("15:30");
    expect(times).toHaveLength(14);
    const load = buildLoad([
      { pickupDate: "2026-11-20", pickupSlot: "10:00" },
      { pickupDate: "2026-11-20", pickupSlot: "10:00" },
    ]);
    const slot = slotsFor("2026-11-20", { settings: settings(), load }).find((s) => s.time === "10:00");
    expect(slot).toEqual({ time: "10:00", remaining: 0, available: false });
  });
  it("checks a booking on the server", () => {
    expect(checkBooking("2026-11-20", "10:00", ctx()).ok).toBe(true);
    expect(checkBooking("2026-11-20", "10:15", ctx()).ok).toBe(false);
    expect(checkBooking("2026-11-16", "10:00", ctx()).ok).toBe(false);
    const load = buildLoad([
      { pickupDate: "2026-11-20", pickupSlot: "10:00" },
      { pickupDate: "2026-11-20", pickupSlot: "10:00" },
    ]);
    const res = checkBooking("2026-11-20", "10:00", ctx({ load }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/full/);
  });
  it("marks a date full when every slot is taken", () => {
    const s = settings({ pickupStart: "09:00", pickupEnd: "10:00", slotCap: 1, dailyCap: 10 });
    const load = buildLoad([
      { pickupDate: "2026-11-20", pickupSlot: "09:00" },
      { pickupDate: "2026-11-20", pickupSlot: "09:30" },
    ]);
    expect(dateStatus("2026-11-20", ctx({ settings: s, load })).state).toBe("full");
  });
});

describe("visibility", () => {
  it("only shows visible items", () => {
    const list = items().map((i) => (i.id === "fl-red-velvet" ? { ...i, visible: false } : i));
    expect(visibleItems(list).some((i) => i.id === "fl-red-velvet")).toBe(false);
  });
  it("never hides the last option in a required step", () => {
    let list = items().filter((i) => i.category !== "size" || i.id === "size-6-round");
    const res = canSetVisibility(list, "size-6-round", false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("Keep at least one size visible.");
    list = items();
    expect(canSetVisibility(list, "size-6-round", false).ok).toBe(true);
    expect(canSetVisibility(list, "nope", false).ok).toBe(false);
  });
  it("allows hiding every optional item", () => {
    const list = items().filter((i) => i.category !== "extra" || i.id === "ext-candles");
    expect(canSetVisibility(list, "ext-candles", false).ok).toBe(true);
  });
  it("drops hidden choices and falls back to the first visible option", () => {
    const list = items().map((i) =>
      i.id === "fl-vanilla" || i.id === "dec-gold-leaf" ? { ...i, visible: false } : i,
    );
    const { config, removed } = sanitizeConfig({ ...baseConfig, decorations: ["dec-gold-leaf", "dec-sprinkles"] }, list);
    expect(config.flavour).toBe("fl-chocolate");
    expect(config.decorations).toEqual(["dec-sprinkles"]);
    expect(removed).toEqual(["Vanilla bean", "Gold leaf"]);
  });
  it("applies dietary filters", () => {
    const list = items();
    const vegan = list.find((i) => i.id === "fl-vegan-chocolate")!;
    const vanilla = list.find((i) => i.id === "fl-vanilla")!;
    expect(clashesWith(vegan, ["egg-free", "dairy-free"])).toBeNull();
    expect(clashesWith(vanilla, ["egg-free"])).toBe("contains egg");
    const { config } = sanitizeConfig({ ...baseConfig, decorations: ["dec-macarons"] }, list, ["nut-free", "gluten-friendly"]);
    expect(config.flavour).toBe("fl-gf-vanilla");
    expect(config.decorations).toEqual([]);
  });
  it("builds a starting config and trims topper text", () => {
    const c = emptyConfig(items());
    expect(c.size).toBe("size-6-round");
    expect(sanitizeConfig({ ...c, topperText: "  Sophia is turning two and loves cake  " }, items()).config.topperText).toHaveLength(30);
  });
});

describe("stages", () => {
  it("moves through the tracker in order", () => {
    expect(nextStage("received")).toBe("design_confirmed");
    expect(nextStage("ready")).toBe("collected");
    expect(nextStage("collected")).toBeNull();
    expect(nextStage("cancelled")).toBeNull();
    expect(nextStage("awaiting_payment")).toBeNull();
    expect(stageIndex("received")).toBe(0);
  });
});
