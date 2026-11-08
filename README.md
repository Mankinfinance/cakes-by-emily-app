# Cakes by Emily: online ordering

A mobile-first website where customers design a custom cake, see the price as they go, pick a date and a 30 minute pickup time, and pay a deposit through Stripe. Emily runs everything from a private admin area: orders, progress updates with photos and videos, prices, what's shown on the menu, capacity, days off and peak dates.

This covers **phases 1 to 3** of the plan:

1. Ordering and payments.
2. The time-savers (automatic messages, design approval, a waitlist, a kitchen sheet, change or cancel under Emily's terms), seasonal boxes and gift vouchers.
3. Corporate packages, reviews, referrals and a stamp card, party add-ons, a sales snapshot, and Cake and Sip classes with private group bookings.

What's left for a later phase is listed under [Future work](#future-work-phase-4).

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
3. Developers, Webhooks, add an endpoint: `https://YOUR-DOMAIN/api/stripe/webhook`, listening to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy its signing secret (`whsec_...`).
4. To test locally, the [Stripe CLI](https://stripe.com/docs/stripe-cli) can forward webhooks: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
5. Refunds are made in the Stripe dashboard.

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
3. Place a few real test orders end to end in Stripe test mode (use Stripe's test card 4242 4242 4242 4242).
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

## Future work (phase 4)

Not built yet, on purpose:

- **Split payments for private groups**: each guest pays their share from a link.
- **Guest invite link**: the organiser shares one link and each guest adds their own name and allergies.
- **Class photo gallery**: Emily uploads class photos and guests download and share them.
- **3-class pass**: buy three classes up front at a discount.
- Gift vouchers and credit codes on classes, seasonal boxes and corporate orders (today they work on cake orders).
- Customer-initiated cancellation for class bookings (today Emily cancels them from the admin, with the refund recorded).
- Automated Stripe refunds (today every refund is made by hand in the Stripe dashboard, as the order shows).

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
- The business name lives in `src/lib/config.ts` if Emily picks a different brand.

**What the automated tests cover, and what they don't.** Unit tests run the real pricing, calendar, terms, waitlist, voucher and order code, the real SQL migrations on PGlite (including the Row Level Security checks, box stock, class seats, voucher redemption and returns, referral rules, and a check that the SQL sales summary matches the app's own calculation. PGlite runs one query at a time, so the "many buyers at once" test proves the logic and the database constraint rather than true parallel load), and the real Stripe webhook route with Stripe's own signature tools. End-to-end tests drive a production build in a real browser on the in-memory adapter with a pretend checkout. **Nothing has been tested against live Supabase, Stripe or Resend accounts yet.** Do that with test keys before launch (steps 2 to 6 above).
