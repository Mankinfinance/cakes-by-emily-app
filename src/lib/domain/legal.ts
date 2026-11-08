// Draft terms of sale and privacy policy. Every number that has a setting is
// filled in from Emily's settings, so the pages always match how the site
// actually behaves. Anything still in [square brackets] is a placeholder for
// Emily to fill in (the pages show those in a different style).

import { formatAud } from "./money";
import type { Settings } from "./types";

export interface LegalSection {
  heading: string;
  paras?: string[];
  bullets?: string[];
}

export interface LegalDocument {
  title: string;
  intro: string;
  sections: LegalSection[];
}

export interface LegalContext {
  businessName: string;
  siteName: string;
  suburb: string;
  instagram: string;
  /** Smallest class size across class types (a class runs with at least this many guests). */
  classMinGuests: number;
  /** Deposits for private classes (adult packages and kids' parties), from the package settings. */
  privateDepositCents: number;
  kidsDepositCents: number | null;
}

type LegalSettings = Pick<
  Settings,
  | "depositPercent"
  | "balanceDueDays"
  | "minNoticeDays"
  | "rushFeeCents"
  | "freeDesignChangeRounds"
  | "changeCutoffDays"
  | "freeDateChanges"
  | "cancelFullRefundDays"
  | "cancelAdminFeeCents"
  | "cancelCreditDays"
  | "voucherValidMonths"
  | "passCredits"
  | "passValidMonths"
  | "classFullRefundDays"
  | "classCreditDays"
  | "splitDueDays"
  | "privatePackages"
>;

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);
const months = (n: number) => (n === 1 ? "1 month" : `${n} months`);
const rounds = (n: number) => (n === 0 ? "no free rounds" : n === 1 ? "1 free round" : `${n} free rounds`);

/** The private class deposits from the package settings (the most common adult one, and the kids' one). */
export function privateDeposits(packages: Settings["privatePackages"]): { adult: number; kids: number | null } {
  const adult = packages.filter((p) => !p.kids).map((p) => p.depositCents);
  const kids = packages.filter((p) => p.kids).map((p) => p.depositCents);
  return { adult: adult.length ? Math.max(...adult) : 0, kids: kids.length ? Math.max(...kids) : null };
}

export function termsDocument(s: LegalSettings, c: LegalContext): LegalDocument {
  const creditFrom = s.cancelCreditDays;
  const creditTo = s.cancelFullRefundDays - 1;
  const classCreditTo = s.classFullRefundDays - 1;
  return {
    title: "Terms of sale",
    intro: `These terms apply to orders and bookings made through ${c.siteName}. Please read them before you pay.`,
    sections: [
      {
        heading: "1. Who we are",
        paras: [
          `${c.siteName} is the online ordering service for ${c.businessName}, a home-based cake business in ${c.suburb}. ABN: [Emily's ABN]. Contact: [email] or Instagram @${c.instagram}.`,
        ],
      },
      {
        heading: "2. Orders and deposits",
        bullets: [
          "Your order is confirmed once your deposit is paid. Until then, the date is not held.",
          `Custom cakes need a deposit of ${s.depositPercent}% of the order total. Rush orders and seasonal boxes are paid in full at checkout.`,
          `The balance is due ${days(s.balanceDueDays)} before pickup. We will remind you by email. If the balance is not paid by then, we may treat the order as cancelled under section 5.`,
          "Prices shown at checkout include all selected options and fees. [GST: Emily to confirm whether she is registered for GST.]",
        ],
      },
      {
        heading: "3. Notice, rush orders and peak dates",
        bullets: [
          `We need at least ${days(s.minNoticeDays)}' notice for custom cakes.`,
          `Orders inside that window may be accepted as rush orders when we have capacity, for a rush fee of ${formatAud(s.rushFeeCents)}. Rush fees are non-refundable.`,
          "Some dates (for example Mother's Day weekend or Christmas week) carry a peak-date surcharge, shown in the calendar before you book. Peak surcharges are non-refundable.",
        ],
      },
      {
        heading: "4. Design and changes",
        bullets: [
          `We will send you a design sketch or mood board to approve. Your order includes ${rounds(s.freeDesignChangeRounds)} of changes. Further changes may incur a fee, which we will confirm with you first.`,
          `Design changes can be made up to ${days(s.changeCutoffDays)} before pickup.`,
          s.freeDateChanges > 0
            ? `You can change your pickup date ${s.freeDateChanges === 1 ? "once" : `${s.freeDateChanges} times`} for free, up to ${days(s.changeCutoffDays)} before pickup, if we have capacity on the new date.`
            : "Pickup dates can't be changed online. Please message us and we'll see what we can do.",
          "Handmade cakes vary slightly. Colours, flowers and decorations may differ a little from inspiration photos or the on-screen preview, which is a guide only.",
        ],
      },
      {
        heading: "5. Cancellations and refunds (custom cakes)",
        bullets: [
          `${days(s.cancelFullRefundDays)} or more before pickup: your deposit is refunded, less an admin fee of ${formatAud(s.cancelAdminFeeCents)}.`,
          ...(creditTo >= creditFrom
            ? [`${creditFrom} to ${days(creditTo)} before pickup: your deposit is kept as credit, valid for ${months(s.voucherValidMonths)}.`]
            : []),
          `Less than ${days(creditFrom)} before pickup: the deposit is non-refundable.`,
          "Rush fees and peak-date surcharges are non-refundable.",
          "Any gift voucher, credit or pass you used on a cancelled order is returned as credit.",
          "If we have to cancel your order, you will get a full refund.",
          "Nothing in these terms limits your rights under the Australian Consumer Law.",
        ],
      },
      {
        heading: "6. Seasonal boxes, vouchers and passes",
        bullets: [
          "Seasonal boxes are made in limited numbers and are non-refundable once paid, except where required by law.",
          `Gift vouchers are valid for ${months(s.voucherValidMonths)} from purchase, can be used across more than one order, and cannot be exchanged for cash.`,
          `Class passes include ${s.passCredits === 1 ? "1 class seat" : `${s.passCredits} class seats`} and are valid for ${months(s.passValidMonths)}.`,
        ],
      },
      {
        heading: "7. Cake & Sip classes",
        bullets: [
          `Class seats are paid in full when booking. Private group bookings need a deposit of ${formatAud(c.privateDepositCents)}${c.kidsDepositCents != null ? ` (${formatAud(c.kidsDepositCents)} for kids' parties)` : ""}, with the balance shared between guests or paid by the organiser by ${days(s.splitDueDays)} before the class.`,
          `Cancelling a class booking: ${days(s.classFullRefundDays)} or more before, full refund;${classCreditTo >= s.classCreditDays ? ` ${s.classCreditDays} to ${days(classCreditTo)} before, credit;` : ""} less than ${days(s.classCreditDays)} before, no refund.`,
          `A class needs at least ${c.classMinGuests} guests to run. If we cancel a class, you will get a full refund, including any credit or pass used.`,
          "Adult Cake & Sip classes are BYO drinks, for guests aged 18 and over. Please drink responsibly. We may refuse service to anyone who is intoxicated. [Emily to confirm BYO arrangements meet any local requirements.]",
          "Children in kids' classes must be accompanied by a parent or guardian, who stays for the class.",
        ],
      },
      {
        heading: "8. Pickup, delivery and cake care",
        bullets: [
          "Please arrive within your 30-minute pickup window. If you are running late, message us. Cakes not collected on the day may not be available later.",
          `Pickup is from our studio in ${c.suburb}. The address is sent with your booking.`,
          "[Delivery: Emily to confirm whether she delivers, the area and the fee.]",
          "Once a cake leaves our hands, transport and storage are your responsibility. Keep it flat in a cool car (not on a seat), out of direct sun, and refrigerate or store as advised on your care card. Tiered cakes may contain supports and dowels that must be removed before serving. [Emily to add any non-edible decorations note.]",
        ],
      },
      {
        heading: "9. Allergies",
        bullets: [
          "Our kitchen also handles nuts, gluten, egg, dairy, soy and sesame. We take care, but cannot guarantee any product is free from allergens.",
          "Please tell us about every allergy and dietary need when ordering or booking. Allergen information shown on this site is a guide, which Emily confirms for each order.",
        ],
      },
      {
        heading: "10. Photos",
        paras: [
          "We love sharing our work. We may photograph your cake (not you or your guests) and post it online. If you would rather we didn't, tick the box at checkout or let us know. Class photos are only shared with your class guests unless you agree otherwise.",
        ],
      },
      {
        heading: "11. Changes to these terms",
        paras: ["We may update these terms. The version shown when you placed your order applies to that order.", "Last updated: [date]"],
      },
    ],
  };
}

export function privacyDocument(c: Pick<LegalContext, "businessName" | "siteName">): LegalDocument {
  return {
    title: "Privacy policy",
    intro: `How ${c.siteName} (run by ${c.businessName}) collects, uses and looks after your information.`,
    sections: [
      {
        heading: "What we collect",
        bullets: [
          "Your name, email address and mobile number, so we can confirm and manage your order.",
          "Your cake choices, dates, pickup time, inspiration photos and any notes.",
          "Allergy and dietary information, which is sensitive information. We collect it only with your consent and only to make your order or class safe.",
          "For classes: guest names and their allergy and dietary information, provided by guests or the organiser.",
          "For birthday reminders: the month and first name you choose to give us, only if you ask for a reminder.",
        ],
      },
      { heading: "What we don't collect", paras: ["We never see or store your card details. Payments are handled by Stripe, which has its own privacy policy."] },
      {
        heading: "How we use it",
        paras: [
          "To make and deliver your order or class, send order messages (confirmations, reminders, pickup details), answer your questions, and keep business records. We send marketing emails, newsletters and rebooking reminders only if you opt in, and you can unsubscribe at any time.",
        ],
      },
      {
        heading: "Who we share it with",
        paras: [
          "Only the services that help us run the business: Stripe (payments), Supabase (secure order storage), Resend (email) and Vercel (website hosting). Some of these may store data outside Australia. We do not sell your information.",
        ],
      },
      {
        heading: "How long we keep it",
        paras: [
          "We keep order records for as long as needed for tax and business records [Emily to confirm, often 5 to 7 years], and delete inspiration photos and class photos after [12] months.",
        ],
      },
      {
        heading: "Your choices",
        paras: [
          "You can ask to see, correct or delete your information by emailing [email]. If you have a privacy concern, contact us first. If you are not satisfied, you can contact the Office of the Australian Information Commissioner (oaic.gov.au).",
        ],
      },
      {
        heading: "Security",
        paras: ["Your information is stored with encryption, access is limited to Emily's own two-factor protected accounts, and order links are private and hard to guess."],
      },
      { heading: "Updates", paras: ["Last updated: [date]"] },
    ],
  };
}

/** Splits text into plain parts and [placeholder] parts, for styling. */
export function placeholderParts(text: string): { text: string; placeholder: boolean }[] {
  const out: { text: string; placeholder: boolean }[] = [];
  const re = /\[[^\]]+\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), placeholder: false });
    out.push({ text: m[0], placeholder: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), placeholder: false });
  return out;
}
