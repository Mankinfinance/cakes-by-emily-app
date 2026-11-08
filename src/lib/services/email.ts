// Emails via Resend. Without an API key (local tests) emails go to an
// in-memory outbox instead, so nothing is ever sent by accident.

import { Resend } from "resend";
import { BUSINESS } from "../config";
import { formatDateLong, formatTime12 } from "../domain/dates";
import { formatAud } from "../domain/money";
import { balanceOwing } from "../domain/pricing";
import { STAGE_MESSAGES, stageLabel } from "../domain/stages";
import type { BoxOrder, CancellationRecord, Order, Stage, Voucher, WaitlistEntry } from "../domain/types";

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

function render(
  paragraphs: string[],
  link?: { href: string; label: string },
  highlight?: { label: string; value: string },
): { text: string; html: string } {
  const text = [
    ...paragraphs,
    ...(highlight ? [`${highlight.label}: ${highlight.value}`] : []),
    ...(link ? [`${link.label}: ${link.href}`] : []),
    "",
    BUSINESS.name,
  ].join("\n\n");
  const code = highlight
    ? `<div style="margin:20px 0;padding:18px;border:2px dashed #B8955A;border-radius:14px;text-align:center;background:#FBF7F4"><p style="margin:0 0 6px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#75636B">${escapeHtml(highlight.label)}</p><p style="margin:0;font-family:'Courier New',monospace;font-size:22px;font-weight:700;letter-spacing:0.08em;color:#2E2027">${escapeHtml(highlight.value)}</p></div>`
    : "";
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("") + code;
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
    subject: `Pickup details: ${when(o)}`,
    ...render(
      [
        `Hi ${firstName(o)}, your cake is nearly ready! See you on ${when(o)}.`,
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

// Phase 2 templates ------------------------------------------------------

export function designForApprovalEmail(o: Order, note: string, link: string): Email {
  return {
    to: o.email,
    subject: "Your cake design is ready to approve",
    ...render(
      [
        `Hi ${firstName(o)}, Emily has sketched your cake design.`,
        note ? `Emily's note: "${note}"` : "",
        "Please take a look and approve it, or ask for a change, from your order page.",
      ].filter(Boolean),
      { href: link, label: "See your design" },
    ),
  };
}

export function changeRequestedAlertEmail(o: Order, request: string, adminLink: string, to: string, extraRound: boolean): Email {
  return {
    to,
    subject: `Design change requested: ${o.reference}`,
    ...render(
      [
        `${o.customerName} asked for a change to their design:`,
        `"${request}"`,
        extraRound ? "They have used their free change round, so you may want to confirm any extra cost." : "",
      ].filter(Boolean),
      { href: adminLink, label: "Open the order" },
    ),
  };
}

export function designApprovedAlertEmail(o: Order, adminLink: string, to: string): Email {
  return {
    to,
    subject: `Design approved: ${o.reference}`,
    ...render([`${o.customerName} approved their design for ${when(o)}.`], { href: adminLink, label: "Open the order" }),
  };
}

export function thankYouEmail(o: Order, link: string, reviewUrl: string): Email {
  return {
    to: o.email,
    subject: `Thank you from ${BUSINESS.name}`,
    ...render(
      [
        `Hi ${firstName(o)}, thank you so much for choosing ${BUSINESS.name}! I hope everyone loved the cake.`,
        reviewUrl
          ? "If you have a minute, a quick review would mean the world to a small business like mine, and a photo of the cake at the party is always a bonus."
          : "If you have a moment, I'd love to see a photo of the cake at the party. Tag @" + BUSINESS.instagram + " on Instagram.",
      ],
      reviewUrl ? { href: reviewUrl, label: "Leave a review" } : { href: link, label: "View your order" },
    ),
  };
}

export function rebookReminderEmail(o: Order, orderUrl: string): Email {
  return {
    to: o.email,
    subject: "A birthday is coming up!",
    ...render(
      [
        `Hi ${firstName(o)}, last year you asked me to remind you before the next birthday. It's almost that time again!`,
        "Dates book out quickly, so get in early if you'd like a cake.",
      ],
      { href: orderUrl, label: "Design this year's cake" },
    ),
  };
}

export function waitlistJoinedEmail(w: WaitlistEntry, place: number): Email {
  return {
    to: w.email,
    subject: `You're on the waitlist for ${formatDateLong(w.date)}`,
    ...render([
      `Hi ${w.customerName.split(" ")[0]}, you're number ${place} on the waitlist for ${formatDateLong(w.date)}.`,
      "If a spot opens up, I'll email you a link to claim it. You'll have 24 hours to book before it goes to the next person.",
    ]),
  };
}

export function waitlistOfferEmail(w: WaitlistEntry, claimLink: string, expiresAt: string): Email {
  const until = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }).format(new Date(expiresAt));
  return {
    to: w.email,
    subject: `A spot opened on ${formatDateLong(w.date)}`,
    ...render(
      [
        `Hi ${w.customerName.split(" ")[0]}, good news! A spot has opened up on ${formatDateLong(w.date)}.`,
        `It's held for you until ${until}. Your cake design is saved, so you just need to pick a pickup time and pay the deposit.`,
      ],
      { href: claimLink, label: "Claim your spot" },
    ),
  };
}

export function cancellationEmail(o: Order, r: CancellationRecord, link: string): Email {
  return {
    to: o.email,
    subject: `Order ${o.reference} cancelled`,
    ...render(
      [
        `Hi ${firstName(o)}, your order ${o.reference} for ${formatDateLong(o.pickupDate)} has been cancelled.`,
        r.summary,
        r.refundCents > 0 ? `Your refund of ${formatAud(r.refundCents)} will be made to your card within a few business days.` : "",
        r.creditCents + r.voucherReturnedCents > 0 ? "Any credit has been sent in a separate email with your code." : "",
      ].filter(Boolean),
      { href: link, label: "View your order" },
    ),
  };
}

export function cancellationAlertEmail(o: Order, r: CancellationRecord, adminLink: string, to: string): Email {
  return {
    to,
    subject: `Cancelled: ${o.reference}${r.refundCents > 0 ? ` (refund ${formatAud(r.refundCents)} in Stripe)` : ""}`,
    ...render(
      [
        `${o.customerName}'s order for ${when(o)} was cancelled by ${r.by === "emily" ? "you" : "the customer"}.`,
        r.refundCents > 0 ? `ACTION: refund ${formatAud(r.refundCents)} in the Stripe dashboard.` : "No cash refund is due.",
        r.creditCents > 0 ? `${formatAud(r.creditCents)} was issued as a credit code.` : "",
        r.voucherReturnedCents > 0 ? `${formatAud(r.voucherReturnedCents)} of voucher or credit was given back.` : "",
      ].filter(Boolean),
      { href: adminLink, label: "Open the order" },
    ),
  };
}

export function creditCodeEmail(to: string, name: string, code: string, amountCents: number, expiresOn: string, reason: string): Email {
  return {
    to,
    subject: `Your ${formatAud(amountCents)} credit with ${BUSINESS.name}`,
    ...render(
      [
        `Hi ${name.split(" ")[0] || "there"}, ${reason}`,
        `You have ${formatAud(amountCents)} of credit to use on a future order. Enter the code at checkout. It's valid until ${formatDateLong(expiresOn)}.`,
        "Keep this email safe: anyone with the code can use the credit.",
      ],
      undefined,
      { label: "Credit code", value: code },
    ),
  };
}

export function dateChangedEmail(o: Order, link: string): Email {
  return {
    to: o.email,
    subject: `New pickup time for order ${o.reference}`,
    ...render([`Hi ${firstName(o)}, your pickup is now ${when(o)}. See you then!`], { href: link, label: "View your order" }),
  };
}

export function dateChangedAlertEmail(o: Order, from: string, adminLink: string, to: string): Email {
  return {
    to,
    subject: `Date moved: ${o.reference}`,
    ...render([`${o.customerName} moved their pickup from ${from} to ${when(o)}.`], { href: adminLink, label: "Open the order" }),
  };
}

const boxWhen = (b: BoxOrder) => `${formatDateLong(b.pickupDate)} at ${formatTime12(b.pickupSlot)}`;

export function boxConfirmationEmail(b: BoxOrder, link: string): Email {
  return {
    to: b.email,
    subject: `Pre-order ${b.reference} confirmed: ${b.boxName}`,
    ...render(
      [
        `Hi ${b.customerName.split(" ")[0]}, thank you! Your pre-order is confirmed.`,
        `${b.quantity} x ${b.boxName}, paid ${formatAud(b.amountPaidCents)}.`,
        `Pickup: ${boxWhen(b)} in ${BUSINESS.suburb}.`,
      ],
      { href: link, label: "View your pre-order" },
    ),
  };
}

export function boxAlertEmail(b: BoxOrder, to: string): Email {
  return {
    to,
    subject: `New pre-order ${b.reference}: ${b.quantity} x ${b.boxName}`,
    ...render([`${b.customerName} (${b.email}, ${b.phone}) pre-ordered ${b.quantity} x ${b.boxName}.`, `Pickup: ${boxWhen(b)}.`]),
  };
}

export function voucherEmail(v: Voucher, code: string, to: "buyer" | "recipient"): Email {
  const forName = v.recipientName || "you";
  const paragraphs =
    to === "buyer"
      ? [
          `Hi ${v.buyerName.split(" ")[0]}, thank you for buying a ${formatAud(v.amountCents)} gift voucher for ${forName}!`,
          v.recipientEmail ? `We've also emailed it to ${v.recipientEmail}.` : "Forward this email, or print it, to give it to them.",
        ]
      : [`Hi ${v.recipientName.split(" ")[0] || "there"}, ${v.buyerName} has sent you a ${formatAud(v.amountCents)} gift voucher for ${BUSINESS.name}!`];
  if (v.message) paragraphs.push(`"${v.message}"`);
  paragraphs.push(`Use the code at checkout when you design your cake. Valid until ${formatDateLong(v.expiresOn)}.`);
  return {
    to: to === "buyer" ? v.buyerEmail : v.recipientEmail,
    subject: to === "buyer" ? `Your ${BUSINESS.name} gift voucher` : `${v.buyerName} sent you a ${BUSINESS.name} gift voucher`,
    ...render(paragraphs, undefined, { label: `${formatAud(v.amountCents)} gift voucher`, value: code }),
  };
}

export function latePaymentAlertEmail(reference: string, amountCents: number, to: string): Email {
  return {
    to,
    subject: `Payment for expired order ${reference}`,
    ...render([
      `A payment of ${formatAud(amountCents)} arrived for ${reference} after it had expired and been cancelled.`,
      "ACTION: refund it in the Stripe dashboard, or contact the customer to re-book.",
    ]),
  };
}
