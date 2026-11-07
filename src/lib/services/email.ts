// Emails via Resend. Without an API key (local tests) emails go to an
// in-memory outbox instead, so nothing is ever sent by accident.

import { Resend } from "resend";
import { BUSINESS } from "../config";
import { formatDateLong, formatTime12 } from "../domain/dates";
import { formatAud } from "../domain/money";
import { balanceOwing } from "../domain/pricing";
import { STAGE_MESSAGES, stageLabel } from "../domain/stages";
import type { Order, Stage } from "../domain/types";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

const g = globalThis as unknown as { __cakesOutbox?: Email[] };
export function outbox(): Email[] {
  g.__cakesOutbox ??= [];
  return g.__cakesOutbox;
}

const outboxMailer: Mailer = {
  async send(email) {
    outbox().push(email);
  },
};

let resend: Resend | null = null;
const resendMailer: Mailer = {
  async send(email) {
    resend ??= new Resend(process.env.RESEND_API_KEY);
    const from = process.env.EMAIL_FROM ?? `${BUSINESS.name} <orders@example.com>`;
    const { error } = await resend.emails.send({ from, to: email.to, subject: email.subject, text: email.text, html: email.html });
    if (error) throw new Error(`Email failed: ${error.message}`);
  },
};

export function getMailer(): Mailer {
  return process.env.RESEND_API_KEY ? resendMailer : outboxMailer;
}

/** Send without letting an email problem break the request. */
export async function sendSafely(mailer: Mailer, email: Email): Promise<boolean> {
  try {
    await mailer.send(email);
    return true;
  } catch (err) {
    console.error("Email not sent:", err instanceof Error ? err.message : err);
    return false;
  }
}

// Templates -------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function render(paragraphs: string[], link?: { href: string; label: string }): { text: string; html: string } {
  const text = [...paragraphs, ...(link ? [`${link.label}: ${link.href}`] : []), "", BUSINESS.name].join("\n\n");
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
  const button = link
    ? `<p style="margin:22px 0"><a href="${escapeHtml(link.href)}" style="background:#B4506E;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">${escapeHtml(link.label)}</a></p>`
    : "";
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#2E2027;background:#FBF7F4;padding:24px;line-height:1.5"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px"><p style="font-family:Georgia,serif;font-size:22px;margin:0 0 18px">${escapeHtml(BUSINESS.name)}</p>${body}${button}</div></div>`;
  return { text, html };
}

const when = (o: Order) => `${formatDateLong(o.pickupDate)} at ${formatTime12(o.pickupSlot)}`;
const firstName = (o: Order) => o.customerName.split(" ")[0];

export function customerConfirmationEmail(o: Order, link: string): Email {
  const owing = balanceOwing(o);
  return {
    to: o.email,
    subject: `Order ${o.reference} confirmed: pickup ${formatDateLong(o.pickupDate)}`,
    ...render(
      [
        `Hi ${firstName(o)}, thank you! Your order ${o.reference} is in and your date is locked in.`,
        `Pickup: ${when(o)} in ${BUSINESS.suburb}.`,
        `Paid so far: ${formatAud(o.amountPaidCents)} of ${formatAud(o.totalCents)}.` +
          (owing > 0 ? ` The balance of ${formatAud(owing)} is due before pickup.` : " You're all paid up."),
        "Emily will be in touch to confirm your design. You can follow your cake's progress any time with the link below.",
      ],
      { href: link, label: "View your order" },
    ),
  };
}

export function newOrderAlertEmail(o: Order, adminLink: string, to: string): Email {
  const lines = o.items.map((i) => `${i.name}: ${formatAud(i.amountCents)}`).join("\n");
  return {
    to,
    subject: `New order ${o.reference}: ${formatDateLong(o.pickupDate)} ${formatTime12(o.pickupSlot)}${o.isRush ? " (RUSH)" : ""}`,
    ...render(
      [
        `New order from ${o.customerName} (${o.email}, ${o.phone}).`,
        `Pickup: ${when(o)}.`,
        lines,
        o.config.topperText ? `Topper text: ${o.config.topperText}` : "",
        o.allergyNotes ? `ALLERGIES: ${o.allergyNotes}` : "No allergy notes.",
        o.notes ? `Notes: ${o.notes}` : "",
        `Total ${formatAud(o.totalCents)}, paid ${formatAud(o.amountPaidCents)}.`,
      ].filter(Boolean),
      { href: adminLink, label: "Open in admin" },
    ),
  };
}

export function stageEmail(o: Order, stage: Stage, link: string): Email {
  return {
    to: o.email,
    subject: `Your cake update: ${stageLabel(stage)}`,
    ...render([`Hi ${firstName(o)}, ${STAGE_MESSAGES[stage] ?? stageLabel(stage)}`], { href: link, label: "See your cake's progress" }),
  };
}

export function photoUpdateEmail(o: Order, caption: string, link: string): Email {
  return {
    to: o.email,
    subject: "Emily posted an update on your cake",
    ...render([`Hi ${firstName(o)}, there's a new update on your cake${caption ? `: "${caption}"` : "."}`], {
      href: link,
      label: "See the update",
    }),
  };
}

export function balanceReminderEmail(o: Order, link: string): Email {
  return {
    to: o.email,
    subject: `Balance due for your cake on ${formatDateLong(o.pickupDate)}`,
    ...render(
      [
        `Hi ${firstName(o)}, your cake for ${formatDateLong(o.pickupDate)} is coming up!`,
        `The remaining balance of ${formatAud(balanceOwing(o))} is due now. You can pay securely with the link below.`,
      ],
      { href: link, label: "Pay the balance" },
    ),
  };
}

export function pickupDetailsEmail(o: Order, link: string, details: string): Email {
  return {
    to: o.email,
    subject: `Pickup tomorrow at ${formatTime12(o.pickupSlot)}`,
    ...render(
      [
        `Hi ${firstName(o)}, your cake is nearly ready! See you tomorrow, ${when(o)}.`,
        details,
        "Cake care: keep your cake flat and cool in the car, out of direct sun, and refrigerate if it is a hot day.",
      ],
      { href: link, label: "View your order" },
    ),
  };
}

export function balanceReceiptEmail(o: Order, link: string): Email {
  return {
    to: o.email,
    subject: `Payment received for order ${o.reference}`,
    ...render([`Hi ${firstName(o)}, thank you, your payment has been received. Paid ${formatAud(o.amountPaidCents)} of ${formatAud(o.totalCents)}.`], {
      href: link,
      label: "View your order",
    }),
  };
}
