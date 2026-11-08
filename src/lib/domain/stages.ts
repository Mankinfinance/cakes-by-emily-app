import { STAGES, STAGE_LABELS, type Stage } from "./types";

/** Stages shown on the customer's tracker, in order. Design approval is an optional side step. */
export const TRACKER_STAGES: Stage[] = STAGES.filter((s) => s !== "awaiting_payment" && s !== "awaiting_approval");

/**
 * The stage Emily's "Move to" button goes to. Design approval is optional:
 * Emily enters it by sending a sketch, so "received" moves straight on to
 * "design_confirmed" (for designs agreed some other way).
 */
export function nextStage(stage: Stage): Stage | null {
  if (stage === "cancelled" || stage === "awaiting_payment") return null;
  if (stage === "received" || stage === "awaiting_approval") return "design_confirmed";
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

export function stageIndex(stage: Stage): number {
  if (stage === "awaiting_approval") return TRACKER_STAGES.indexOf("received");
  return TRACKER_STAGES.indexOf(stage);
}

/** Stages where the cake is booked and still to come. */
export function isLive(stage: Stage): boolean {
  return stage !== "awaiting_payment" && stage !== "cancelled" && stage !== "collected";
}

export const STAGE_MESSAGES: Partial<Record<Stage, string>> = {
  received: "Your order is in and your date is locked in.",
  awaiting_approval: "Emily has sent your design. Please take a look and approve it or ask for a change.",
  design_confirmed: "Your design is confirmed. Exciting!",
  baking: "Your cake is in the oven.",
  decorating: "Decorating has started. This is the fun part.",
  ready: "Your cake is ready for pickup.",
  collected: "Thank you for choosing Cakes by Emily. Enjoy the celebration!",
};

export function stageLabel(stage: Stage): string {
  return STAGE_LABELS[stage];
}
