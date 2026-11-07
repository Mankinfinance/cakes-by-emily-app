import { STAGES, STAGE_LABELS, type Stage } from "./types";

/** Stages shown on the customer's tracker, in order. */
export const TRACKER_STAGES: Stage[] = STAGES.filter((s) => s !== "awaiting_payment");

export function nextStage(stage: Stage): Stage | null {
  if (stage === "cancelled" || stage === "awaiting_payment") return null;
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

export function stageIndex(stage: Stage): number {
  return TRACKER_STAGES.indexOf(stage);
}

export const STAGE_MESSAGES: Partial<Record<Stage, string>> = {
  received: "Your order is in and your date is locked in.",
  design_confirmed: "Your design is confirmed. Exciting!",
  baking: "Your cake is in the oven.",
  decorating: "Decorating has started. This is the fun part.",
  ready: "Your cake is ready for pickup.",
  collected: "Thank you for choosing Cakes by Emily. Enjoy the celebration!",
};

export function stageLabel(stage: Stage): string {
  return STAGE_LABELS[stage];
}
