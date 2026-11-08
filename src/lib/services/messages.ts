// Automatic messages. Each one is "claimed" in the database before it is
// sent, so a message can never go out twice, even if the daily job runs
// twice at once. A failed send gives the claim back for the next run.

import { automationMap, dueScheduledMessages } from "../domain/automations";
import { todayInBusinessTz } from "../domain/dates";
import type { AutomationKey, Order } from "../domain/types";
import { BUSINESS } from "../config";
import { nowOf, orderLink, reviewLink, type LightDeps } from "./common";
import {
  balanceReminderEmail,
  customerConfirmationEmail,
  pickupDetailsEmail,
  rebookReminderEmail,
  sendSafely,
  standReturnEmail,
  stageEmail,
  thankYouEmail,
  type Email,
} from "./email";

/** Send a message to an order at most once. Returns true if it was sent now. */
export async function sendOnce(deps: LightDeps, orderId: string, key: string, email: Email): Promise<boolean> {
  if (!(await deps.repo.claimMessage(orderId, key))) return false;
  if (await sendSafely(deps.mailer, email)) return true;
  await deps.repo.releaseMessage(orderId, key);
  return false;
}

export async function automationEnabled(deps: LightDeps, key: AutomationKey): Promise<boolean> {
  return automationMap(await deps.repo.listAutomations())[key].enabled;
}

/** Send one of the event-driven messages (order received, design confirmed) if it is switched on. */
export async function sendEventMessage(deps: LightDeps, order: Order, key: "order_received" | "design_confirmed"): Promise<boolean> {
  if (!(await automationEnabled(deps, key))) return false;
  const link = orderLink(deps.baseUrl, order.id);
  const email = key === "order_received" ? customerConfirmationEmail(order, link) : stageEmail(order, "design_confirmed", link);
  return sendOnce(deps, order.id, key, email);
}

export function pickupDetailsText(): string {
  return process.env.PICKUP_DETAILS || BUSINESS.pickupDetailsPlaceholder;
}

function reviewUrl(settingsUrl: string): string {
  return settingsUrl || process.env.REVIEW_URL || "";
}

/** The daily part: balance reminders, pickup details, thank-yous and birthday reminders. */
export async function runScheduledMessages(deps: LightDeps): Promise<Record<string, number>> {
  const today = todayInBusinessTz(nowOf(deps));
  const [automations, orders, settings] = await Promise.all([deps.repo.listAutomations(), deps.repo.listOrders(), deps.repo.getSettings()]);
  const counts: Record<string, number> = { balance_reminder: 0, pickup_details: 0, thank_you: 0, rebook_reminder: 0, stand_return: 0 };
  for (const o of orders) {
    const sent = (await deps.repo.listMessages(o.id)).map((m) => m.key);
    for (const key of dueScheduledMessages(o, automations, sent, today)) {
      const link = orderLink(deps.baseUrl, o.id);
      const email =
        key === "balance_reminder"
          ? balanceReminderEmail(o, link)
          : key === "pickup_details"
            ? pickupDetailsEmail(o, link, pickupDetailsText())
            : key === "thank_you"
              ? thankYouEmail(o, reviewLink(deps.baseUrl, o.id), reviewUrl(settings.reviewUrl))
              : key === "stand_return"
                ? standReturnEmail(o, link)
                : rebookReminderEmail(o, `${deps.baseUrl}/order`);
      if (await sendOnce(deps, o.id, key, email)) counts[key]++;
    }
  }
  return counts;
}
