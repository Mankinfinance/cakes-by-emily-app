# Layered by Cakes by Emily: online ordering

A mobile-first website where customers design a custom cake, see the price as they go, pick a date and a 30 minute pickup time, and pay a deposit through Stripe. Emily runs everything from a private admin area: orders, progress updates with photos and videos, prices, what's shown on the menu, capacity, days off and peak dates.

This covers **phases 1 to 5** of the plan:

1. Ordering and payments.
2. The time-savers (automatic messages, design approval, a waitlist, a kitchen sheet, change or cancel under Emily's terms), seasonal boxes and gift vouchers.
3. Corporate packages, reviews, referrals and a stamp card, party add-ons, a sales snapshot, and Cake and Sip classes with private group bookings.
4. Split payments and guest details for private classes, class photo galleries, a 3-class pass, vouchers on everything, customers cancelling their own class bookings, and optional automatic Stripe refunds.
5. Guests changing their own details, codes on guests' shares, cancelling some seats of a class booking, automatic refunds of late payments, and launch tools: a setup health page (`/admin/setup`) and a live smoke test.

What's left is listed under [Future work](#future-work).

> **All prices in this code are samples** copied from the concept demo. Emily sets her real prices in the admin before launch.

## What's included

**For customers**

- Home page and an 8 step cake builder (occasion, size, flavour, finish and colour, decorations, extras, date and pickup, details, review) with a live illustrated preview and a live total.
- Allergen tags on every option, and a dietary filter (nut-free, egg-free, dairy-free, gluten-friendly) that greys out options that don't suit.
- A booking calendar that follows Emily's rules: minimum notice, cakes per day and per week, closed weekdays, days off, rush orders inside the notice period (with a rush fee, paid in full, only when there's room) and peak date surcharges.
- 30 minute pickup slots with a limit per slot.
- An optional inspiration photo (resized in the browser, checked on the server).
- Terms to accept at checkout, and secure payment on Stripe's own page (50% deposit, or full payment for rush orders).
- A private order page (an unguessable link, emailed to the customer) with a progress tracker, Emily's photo and video updates, and a "pay balance" button.
- Emails: order confirmation, stage updates, new photo/video updates, a balance reminder, pickup details, a thank-you with a review link, and (for birthdays, if the customer ticks the box) a reminder before next year's birthday. The order page shows which messages have been sent and which are scheduled.
- **Design approval** (phase 2): when Emily sends a sketch, the order page shows it with "Approve design" and "Request a change". One change round is free (a setting); after that the customer is told extra changes may cost more.
- **Change or cancel** (phase 2): the order page shows what applies today under Emily's terms: whether the design and date can still change, and exactly what happens to the money if they cancel ("Today is 20 days before pickup. If you cancel, you'll get $45 back ($65 paid minus the $20 admin fee)."). Customers can move their date once for free (if there's room and the price is the same) or cancel with a confirm step.
- **Waitlist** (phase 2): fully booked dates can be tapped to join a waitlist with the cake design saved. When a place frees up, the first person gets an email with a claim link that holds the place for 24 hours, then it moves to the next person.
- **Seasonal boxes** (phase 2, `/boxes`): limited pre-order boxes with stock left and a countdown, paid in full.
- **Gift vouchers** (phase 2, `/vouchers`): buy a voucher and the code is emailed (to the recipient too, if given). Codes are applied at checkout as credit, partial balances carry over, and they expire after 12 months (a setting).
- **Party add-ons** (phase 3): number candles, sparklers, a box upgrade and cake stand hire, offered on the review step. Stand hire adds a refundable bond and a "please return the stand" reminder after pickup.
- **Referrals and stamp card** (phase 3): every customer gets a referral code on their order page ("Give $10, get $10", both amounts are settings). A new customer using it gets money off their first order, and the referrer gets a credit code when that order's deposit is paid. Every 5th collected order (a setting) earns a free reward, added to the next order automatically as a $0 line.
- **Reviews** (phase 3): the thank-you email links to an on-site review form (a private link, one review per order) with stars, a few words, an optional photo and a tick to agree to it being published. Approved reviews show on the home page (first name and initial only), with a link to leave a Google review too.
- **Corporate orders** (phase 3, `/corporate`): logo cookies and cupcakes in set quantities, a logo upload (PNG, JPG or WebP only), company name and optional ABN, a pickup date and time, and a deposit, with the balance paid later from the order page.
- **Cake and Sip classes** (phase 3, `/classes`): class types with level and age notes, upcoming sessions with seats left, booking 1 to 6 seats with each guest's name and allergies, an 18+ tick for BYO sip classes, a 10% group discount from 4 seats (settings), full payment, a ticket page and an "Add to calendar" file. Sold-out classes take a waitlist: when seats free up, the first person gets an email with a link that holds the seats for 24 hours.
- **Private classes and parties** (phase 3, `/classes/private`): Classic, Deluxe and Ultimate packages and a kids' party, with a live estimate. It's a request: Emily accepts or declines, and accepting emails a link to pay the deposit.

**For Emily (at `/admin`)**

- Sign in with email and password **plus a code from an authenticator app** (two-factor).
- Orders list (upcoming, past, cancelled) with rush and allergy flags.
- Order details, a "move to next step" button that emails the customer, cancel, and "post an update" with a photo or video.
- Prices and menu: change names, prices and allergens, add items, and untick **Show to customers** to hide anything. Hidden items vanish from the builder straight away; orders that already include them keep them. You can't hide the last option in a required step (for example the last size).
- Calendar and settings: notice period, capacity, pickup hours and slot limit, closed weekdays, rush fee and on/off, deposit percentage, reminder timing, checkout terms, days off and peak dates.
- New order alert emails.
- **Kitchen sheet** (`/admin/kitchen`): day and week views in pickup order, allergies highlighted, tick-offs saved, and a clean A4 print layout.
- **Waitlist** (`/admin/waitlist`): who is waiting for each date and whether they have an offer.
- **Seasonal boxes** (`/admin/boxes`): add and edit boxes (price, how many, when pre-orders open and close, pickup window), a "Show to customers" switch, and the pre-order list.
- **Gift vouchers and credit** (`/admin/vouchers`): voucher amounts (each with its own "Show to customers" switch), custom amounts, how long codes last, every code with its balance, and a "void" button.
- **Automatic messages** (`/admin/automations`): turn each message on or off and change when the scheduled ones go out.
- **Send a design for approval** from any new order, with a sketch or mood board.
- **Terms settings**: the cancellation windows, admin fee, free date changes and free design change rounds. The checkout terms and the `/terms` page are written from these.
- **Corporate** (`/admin/corporate`): package prices and "Show to customers" switches, orders with their logos, and ready, collected and cancel buttons. Corporate orders take a cake slot and appear on the kitchen sheet.
- **Reviews** (`/admin/reviews`): approve or hide. Nothing is published until approved, and only reviews the customer agreed to publish can be approved. Collected orders show their review link so Emily can send it by hand too.
- **Referrals and stamp card** (`/admin/referrals`): switch each on or off, set the amounts and the reward, and see every referral.
- **Sales snapshot** (`/admin/snapshot`): this month and last month (orders, revenue booked, deposits taken, average order), top flavours, finishes and occasions, capacity for the next 4 weeks, balances owed (with a list), seasonal box sell-through, and voucher and credit balances outstanding. The money and counts are worked out in the database.
- **Classes** (`/admin/classes`): add one class or a weekly or fortnightly series (days off and closed weekdays are skipped, with a preview first), class prices, minimums and "Show to customers" switches, and a warning on classes below their minimum with a date to decide by. Each class has a guest list with allergy flags, check-in ticks, a printable class-day sheet, "cancel booking" and "cancel class and refund everyone". Days with a class (or an accepted private class) take no cake orders (a setting). Private requests are accepted or declined at `/admin/classes/private`.
- **Cancellations never refund automatically.** Each cancelled order records what is owed: the order page and an email tell Emily exactly how much to refund in the Stripe dashboard. When Emily cancels an order, everything paid is refunded. Credit from a cancellation is emailed to the customer as a **credit code**, and any voucher or credit used on a cancelled order is always given back as credit.

## Keeping customer data safe

- **Cards never touch this site.** Customers pay on Stripe's checkout page.
- **Prices are worked out on the server** from Emily's price list. Nothing the browser sends about price is trusted.
- **Every database table has Row Level Security on.** Customers can't read the database at all. The site's server reads it with a secret key after its own checks.
- **Private order links** are built from a secret, and the database only stores a fingerprint (hash) of each link. A copy of the database alone can't open orders.
- **Admin needs two-factor**, and only emails on the `ADMIN_EMAILS` list can get in.
- Stripe webhooks are signature-checked and safe to retry (a payment is never counted twice).
- Uploads are limited by type and size, and the file contents are checked.
- **Voucher and credit codes** are only stored as a fingerprint (hash) plus their last 4 characters. Using a code is done in one database step, so a code can't be spent twice even if two orders try at the same moment. Checking a code is rate limited to stop guessing.
- **Seasonal box stock** is taken in one database step with a check that sold never exceeds the cap, so boxes can't be oversold. Unpaid checkouts are released by the daily job.
- **Automatic messages** are recorded before they are sent, so none can go out twice.
- **Class seats** are taken in one database step with a check that bookings never exceed the seats, so classes can't be overbooked.
- **Referrals** are checked by email (no self-referral, one referral per new customer) with a database rule backing it up, and the referrer's credit is issued exactly once.
- **Corporate logos** are limited to PNG, JPG and WebP. SVG files can carry scripts, so they are refused.
- **Reviews** only ever show a first name and initial, and the database refuses to publish one without the customer's consent.
- **Guest details** (allergies, dietary needs) are only shown to Emily. The organiser sees names and payment status only.
- **Share links, guest pages, organiser pages and gallery links** are built from the secret, and only their fingerprints are stored. Class pass codes are made the same way as voucher codes (hash and last 4 characters stored).
- **Shares, pass credits and stamp card rewards** are each claimed in one database step, so nothing can be paid or used twice.
- Only the details an order needs are collected. Marketing emails are opt-in.
- Draft **privacy policy** (`/privacy`) and **terms** (`/terms`) pages are included, with [placeholders] for Emily's real wording. Have them checked before launch.

## Accounts Emily needs (all in her own name)

| Account | What it's for | Cost to start |
| --- | --- | --- |
| **GitHub** | Where this code lives | Free |
| **Vercel** | Hosts the website, runs the daily reminder job | Free hobby tier to try; Pro for a business site |
| **Supabase** | Database, admin login, photo and video storage. Choose the **Sydney** region | Free tier to start |
| **Stripe** | Takes payments. Needs her ABN and bank account | No monthly fee; a fee per payment |
| **Resend** | Sends the emails. Needs her domain verified | Free tier to start |
| **A domain name** | e.g. a .com.au for the business | Yearly fee |

Emily should own every account and turn on two-factor sign in for each one. Developers can be invited as members and removed later.

## Setting it up

### 1. Run it on your computer (no accounts needed)

You need Node.js 22 or newer.

```bash
npm install
DATA_ADAPTER=memory E2E_AUTH_BYPASS=1 npm run dev
```

Open http://localhost:3000. This **test mode** keeps everything in memory (it disappears when you stop the server), uses a pretend checkout instead of Stripe, and has a "Sign in (test mode)" button on `/admin/login`. It refuses to run on a Vercel production deployment.

### 2. Supabase

1. Create a project (region: Sydney).
2. Run the database setup: either install the [Supabase CLI](https://supabase.com/docs/guides/cli) and run `supabase link` then `supabase db push`, or paste each file in `supabase/migrations` into the SQL editor and run them **in order** (oldest first). If you already ran the first one, just run the newer ones. Never edit a migration that has already been run.
3. Load the sample menu: paste `supabase/seed.sql` into the SQL editor and run it. It's safe to run again after a new migration (it only adds what's missing). (Regenerate it from `src/lib/data/sample-data.ts` with `npm run seed:sql` if you change the samples.)
4. Create Emily's login: Authentication, Users, Add user (email and a strong password). Turn off public sign ups under Authentication, Sign In / Providers.
5. Optional, for viewing data in the Supabase dashboard as an admin: add her user id to the `admins` table.
6. Two-factor: Authentication, Multi-Factor, make sure **TOTP** (authenticator app) is enabled. The first time Emily signs in to `/admin` she scans a QR code with her authenticator app; after that she enters a 6 digit code each time. The site checks for this on every admin page (`ADMIN_REQUIRE_MFA=true`).
7. Copy the project URL, the anon key and the service role key for the environment variables below.

### 3. Stripe

1. Create the account and complete the business details (ABN, bank account).
2. Stay in **test mode** to begin with. Copy the secret key (`sk_test_...`).
3. Developers, Webhooks, add an endpoint: `https://YOUR-DOMAIN/api/stripe/webhook`, listening to `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `charge.refunded`. Copy its signing secret (`whsec_...`).
4. To test locally, the [Stripe CLI](https://stripe.com/docs/stripe-cli) can forward webhooks: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
5. Refunds are made in the Stripe dashboard, unless Emily turns on automatic refunds (see Phase 4). Try those in test mode first.

### 4. Resend

Add and verify the business domain, create an API key, and set `EMAIL_FROM` to an address on that domain.

### 5. Vercel

1. Import the GitHub repository.
2. Add every variable from `.env.example` under Settings, Environment Variables (Production). Do **not** set `DATA_ADAPTER` or `E2E_AUTH_BYPASS`.
3. Deploy, then add the custom domain.
4. The daily job is set in `vercel.json` (22:00 UTC, which is 9am in Sydney during daylight saving and 8am otherwise). Vercel sends `CRON_SECRET` with each run. Each run:
   - cancels checkouts that were never paid (after an hour) and releases what they held: seasonal box stock, voucher balance, and the date (which is offered to the waitlist);
   - ends waitlist offers older than 24 hours and offers the place to the next person;
   - sends the scheduled automatic messages that are due and switched on.
   Every part is safe to run more than once.

### Environment variables

Every variable is listed and explained in [`.env.example`](.env.example). Never commit real values: `.env*` files are ignored by git (except the example).

### 6. Going live with real payments

1. Work through the pre-launch checklist below.
2. Replace the sample prices and settings in `/admin`.
3. Open `/admin/setup` and fix anything red, then follow [First live test](#first-live-test) in Stripe test mode.
4. In Stripe, switch to live mode, create a **live** webhook endpoint, and swap `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Vercel for the live values. Redeploy.
5. Place one small real order and refund it to confirm everything works.

## Pre-launch checklist

From the plan doc, "Checks before taking real orders". These are things to confirm, not legal advice:

- [ ] Ask the local council what a home-based food business needs (registration, inspection).
- [ ] Check the NSW Food Authority's home-based food business requirements, including any food safety supervisor or training requirement.
- [ ] Confirm allergen details for every flavour, finish, decoration and extra in `/admin`.
- [ ] Public liability insurance that covers products sold.
- [ ] Written terms checked and entered in the admin (deposits, refunds, changes, cake care, rush and peak fees). The cancellation windows, admin fee and free changes are settings in `/admin/settings`.
- [ ] Review link (a Google review URL) added in `/admin/settings`.
- [ ] Seasonal boxes and voucher amounts replaced with real ones (the seeded ones are samples).
- [ ] Corporate package prices, class types and prices, private packages and party add-ons replaced with real ones (all seeded ones are samples).
- [ ] Classes: check with the council about running classes at home, guest numbers, BYO alcohol (Liquor and Gaming NSW), and insurance that covers people attending.
- [ ] Privacy policy and terms pages filled in (`src/app/privacy/page.tsx`, `src/app/terms/page.tsx`).
- [ ] Real prices, notice period, capacity, pickup hours and pickup details (`PICKUP_DETAILS`).
- [ ] Original high-resolution photos for the home page.
- [ ] ABN on the terms page and in Stripe.

## Phase 4

**Split payments and guest details (private classes and kids' parties).** Once the organiser pays the deposit, they're emailed a share link for their guests and a link to their own page. On the share link ("Join Jo's class: add your details and pay your share") each guest adds their name, email, allergies, dietary needs and whether they'd like emails, then pays their share: (total minus deposit) divided by the number of guests, with any odd cents on the first share. Each guest gets their own page to come back to. The organiser's page shows "4 of 8 paid" with names (never anyone's allergies), a reminder button (emails guests who added details but haven't paid; once a day), and from the due date (7 days before the class, a setting) a button to pay all remaining shares. Each share is held while someone is at checkout, so two people can't pay the same share. Emily sees every guest's details and payment status on `/admin/classes/private`, with "details missing" flags.

**Class photo galleries.** On each class's admin page Emily uploads photos (stored privately), deletes any she doesn't want, and emails the gallery link to everyone booked (once per booking). The gallery has a grid, a full-screen viewer, Download, and Share (the phone's share sheet where it's supported, otherwise a download), with the caption tag @_cakes_by_emily_. The link only works with the class's own token.

**3-class pass** (`/classes/pass`). $255 for 3 class seats, valid 12 months (all settings, prices are samples). The code is emailed after payment and entered when booking: each seat uses one credit, taken in one database step. Credits come back if Emily cancels, or if the customer cancels outside the no-refund window. An expired pass gets 90 more days when credits come back to it.

**Vouchers everywhere.** Gift vouchers and credit codes now work on class bookings, seasonal boxes and corporate orders too, with the same rules as cake orders: used in one database step, partial balances kept, and given back as credit on cancellation. On corporate orders the voucher comes off the deposit first.

**Customers cancel class bookings** from their ticket page, under the class terms (settings): 7 or more days before, a full refund; 3 to 6 days, what they paid becomes a credit code; under 3 days, nothing back and pass credits aren't returned. Any voucher used always comes back. Their seats go straight to the class waitlist.

**Automatic refunds (`autoRefunds`, off by default).** With it off, nothing changes: each cancellation records the amount, and Emily refunds it by hand in the Stripe dashboard. With it on, the refund the terms allow is sent to Stripe straight away, split across the payments it came from (newest first: a balance before a deposit, several guests' shares), with an idempotency key on each so a retry never refunds twice. The refund ids are kept with the order. Admin cancel buttons show the amount ("Cancel booking and refund $95 via Stripe") and ask to confirm. If Stripe refuses any part, that part is recorded for a manual refund and Emily gets an email. Stripe's `charge.refunded` webhook keeps each payment's refunded total up to date, including refunds made in the dashboard.

> **Before turning on automatic refunds, try them in Stripe test mode.** Place a test order, cancel it from the admin, and check the refund appears in the Stripe dashboard. Add `charge.refunded` to the webhook endpoint's events (see Stripe setup).

**Stamp card.** Rewards are now claimed in one database step, so two orders placed at the same moment can't both use the same reward. A reward used on a cancelled order can be used again. Stamp cards and referrals are keyed by **email address** (always stored in lower case): the same person using two email addresses has two cards, and someone sharing an address with a partner shares the card.

**New settings** (in `/admin/settings`): class full refund days (7), class credit days (3), shares due days before a private class (7), sell class passes (on), pass price ($255), classes per pass (3), pass valid months (12), and automatic refunds (off).

## Phase 5

**Guests change their own details.** From their own guest link, a private class guest can change their name, email, allergies, dietary needs and email opt-in until a cut-off (2 days before the class, the setting "Guests can change their details until"). From then on the page tells them to message Emily. If the allergy or dietary details change, Emily is emailed straight away with the before and after.

**Codes on a guest's own share.** On their guest page, a guest can enter a gift voucher, a credit code or a 3-class pass code. One code per share, taken in one database step, and never while that share is mid-checkout. A voucher or credit code takes up to what the share still owes (the voucher keeps any balance). **One class pass credit is worth what a credit cost** (the pass price divided by the classes per pass, $85 with the sample settings) because private class shares are priced by package, not per seat. If a code covers the whole share, it is marked paid with no checkout and the organiser's tracker updates. If Emily cancels the private class, every voucher and pass credit used on a share comes back.

**Cancelling some seats.** On their ticket, a customer can tick the guests who can't come, see the new price and what comes back before confirming, then cancel just those seats. How it's worked out:

- The price is worked out again for the seats left, so the group discount drops away if the booking falls below the threshold (4 seats at 10% off, $342, cancelling 1 leaves 3 at $285: $57 back).
- Class pass credits cover seats first, so cancelled seats give credits back before any money.
- Money comes back cash first, then any voucher that paid (as a new credit code).
- 7 or more days before: the cash is refunded. 3 to 6 days: it becomes a credit code. Under 3 days: seats can't be cancelled online (customers can still cancel the whole booking under the class terms, or message Emily).
- At least one seat must stay; cancelling every seat is the whole-booking button.
- Done in one database step that checks the booking hasn't changed since the quote, so two cancels at once can't both apply.
- The freed seats are offered to the class waitlist, the customer gets an updated ticket email, and Emily gets an alert (with "refund $X in Stripe" when automatic refunds are off). The ticket keeps a history of what was cancelled.

**Late payments refunded automatically.** A payment can arrive after its order or booking expired (someone sat on Stripe's page past the hold, or a guest's share hold ran out and someone else paid that share). With automatic refunds on, it is refunded in full through Stripe straight away, with a stable idempotency key so a retried webhook never refunds twice, and Emily gets a "Late payment refunded" email. With them off, or if Stripe refuses, Emily gets the same "refund it in the Stripe dashboard" email as before.

**Setup page (`/admin/setup`).** Admin only, behind two-factor. Green, amber and red checks with plain-English fixes:

- every required environment variable: secrets show only "set" or "missing", addresses show the host only
- the site address matches the page you're on
- Supabase answers, every expected table exists (it names the migration to run if not), the phase 5 migration has been run, and the photo storage bucket exists
- the Stripe key's mode (test or live, from its prefix) and a light "who am I" call to Stripe
- the webhook secret is there and looks right
- Resend is set, with a "Send a test email to ADMIN_NOTIFY_EMAIL" button
- the reminders job secret is set, the order link secret is at least 32 characters, and two-factor is required

On the local test mode it shows a "test mode" banner. It only reads: nothing is changed by opening it.

**Live smoke test (`npm run smoke:live`).** Run from your own computer against the deployed site, in Stripe test mode only:

```bash
SMOKE_BASE_URL=https://your-site.vercel.app \
STRIPE_SECRET_KEY=sk_test_... \
SMOKE_CONFIRM=yes \
npm run smoke:live
```

It refuses to run unless the key starts with `sk_test_` and `SMOKE_CONFIRM=yes`. It checks the site answers, finds a normal date and slot, places one order marked `[SMOKE TEST]` through the public API, prints the Stripe test checkout link for you to pay (Stripe doesn't let a script pay a Checkout page itself; `SMOKE_WAIT_MINUTES` sets how long it waits, default 10), checks the webhook marked the order paid, checks the order link works and an altered link doesn't, then cancels the order (its own clean up) and checks whether Stripe made a refund. It ends with a PASS/FAIL table. The cancelled test order stays visible in the admin marked `[SMOKE TEST]`; if automatic refunds are off, refund the test payment in the Stripe dashboard. Its pure parts are unit tested; the script itself has not been run against a live site from here.

**New setting:** guests can change their details until 2 days before the class (`guestEditCutoffDays`). **New migration:** `supabase/migrations/20261112000000_phase5.sql`. Run it in the Supabase SQL editor after the phase 4 one.

## First live test

Do this in **Stripe test mode** before switching to live payments.

1. Deploy to Vercel with the test keys, run all five migrations and the seed in Supabase, and add the webhook endpoint (`https://<your site>/api/stripe/webhook`) with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `charge.refunded`.
2. Open `/admin/setup`. Fix every red line. Amber is fine for now: the Stripe key will say "test mode", which is what you want.
3. Click "Send a test email" and check it arrives (look in spam too).
4. Place a real order on the site and pay with Stripe's test cards (any future expiry date, any 3 digit CVC, any postcode):

   | Card | What happens |
   |---|---|
   | 4242 4242 4242 4242 | Payment succeeds |
   | 4000 0000 0000 9995 | Declined: the order stays unpaid, and the daily job releases its slot |
   | 4000 0025 0000 3155 | Asks for authentication (3D Secure): complete it to pay, or fail it to see the decline |

5. Check the order page shows the deposit as paid within a minute, Emily gets the new order email, and the order appears in `/admin`.
6. Cancel it from the admin. With automatic refunds off, refund it in the Stripe dashboard; with them on, check the refund appears in Stripe.
7. Optionally run `npm run smoke:live` (above) for a repeatable check.

**If a payment doesn't show as paid:** in Stripe, open Developers, Webhooks, your endpoint, and look at the event deliveries. A red delivery shows the error. Fix it (usually a wrong `STRIPE_WEBHOOK_SECRET` or the endpoint URL), then press **Resend** on that event; the site handles each event once, so resending is safe. With the Stripe CLI you can also forward events to a local copy (`stripe listen --forward-to localhost:3000/api/stripe/webhook`) or replay one (`stripe events resend evt_...`).

## Future work

Not built yet, on purpose:

- Partial cancellation of private classes (fewer guests after the deposit).
- Saving the automatic refund id onto a partial seat cancellation record (it is kept in the refunds table and shown in Stripe).
- Running the live smoke test unattended: Stripe Checkout has to be paid by a person.

## For developers

```bash
npm run dev         # local server
npm run lint        # ESLint
npm run typecheck   # route types + TypeScript
npm test            # unit tests (Vitest), including the SQL migration on PGlite
npm run test:e2e    # end-to-end tests (Playwright) on a production build in test mode
npm run build       # production build
```

- `src/lib/domain`: pure business rules (pricing, availability, slots, rush and peak, visibility, terms, automatic messages, waitlist, vouchers, boxes, kitchen sheet, referrals and stamps, classes, the sales snapshot). Most of the logic lives here and is unit tested.
- `src/lib/data`: the data adapter. `supabase.ts` for the live site, `memory.ts` for tests (`DATA_ADAPTER=memory`).
- `src/lib/services`: order workflows, Stripe, email and private link tokens.
- `src/app`: pages and API routes. Emily's admin is under `src/app/admin`.
- `supabase/migrations`: the database schema, Row Level Security, and the functions that must be exact: recording a payment once, taking box stock, and using or giving back voucher balance. Add changes as **new** files; never edit one that may already have been run.
- The site name ("Layered by Cakes by Emily") and business details live in `src/lib/config.ts`.

**What the automated tests cover, and what they don't.** Unit tests run the real pricing, calendar, terms, waitlist, voucher and order code, the real SQL migrations on PGlite (including the Row Level Security checks, box stock, class seats, guest places and share holds, pass credits, voucher redemption and returns on every kind of order, refund totals, stamp card claims, referral rules, codes on guests' shares, partial seat cancellations, and a check that the SQL sales summary matches the app's own calculation. PGlite runs one query at a time, so the "many buyers at once" test proves the logic and the database constraint rather than true parallel load), and the real Stripe webhook route with Stripe's own signature tools. End-to-end tests drive a production build in a real browser on the in-memory adapter with a pretend checkout (and pretend refunds). **Nothing has been tested against live Supabase, Stripe or Resend accounts yet.** Do that with test keys before launch: `/admin/setup`, then [First live test](#first-live-test).
