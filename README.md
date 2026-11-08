# Cakes by Emily: online ordering

A mobile-first website where customers design a custom cake, see the price as they go, pick a date and a 30 minute pickup time, and pay a deposit through Stripe. Emily runs everything from a private admin area: orders, progress updates with photos and videos, prices, what's shown on the menu, capacity, days off and peak dates.

This is **phase 1** of the plan. Seasonal boxes, corporate packages, gift vouchers, classes and the other ideas from the concept demo come later.

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
- Emails: order confirmation, stage updates, new photo/video updates, a balance reminder 4 days before pickup, and pickup details the day before.

**For Emily (at `/admin`)**

- Sign in with email and password **plus a code from an authenticator app** (two-factor).
- Orders list (upcoming, past, cancelled) with rush and allergy flags.
- Order details, a "move to next step" button that emails the customer, cancel, and "post an update" with a photo or video.
- Prices and menu: change names, prices and allergens, add items, and untick **Show to customers** to hide anything. Hidden items vanish from the builder straight away; orders that already include them keep them. You can't hide the last option in a required step (for example the last size).
- Calendar and settings: notice period, capacity, pickup hours and slot limit, closed weekdays, rush fee and on/off, deposit percentage, reminder timing, checkout terms, days off and peak dates.
- New order alert emails.

## Keeping customer data safe

- **Cards never touch this site.** Customers pay on Stripe's checkout page.
- **Prices are worked out on the server** from Emily's price list. Nothing the browser sends about price is trusted.
- **Every database table has Row Level Security on.** Customers can't read the database at all. The site's server reads it with a secret key after its own checks.
- **Private order links** are built from a secret, and the database only stores a fingerprint (hash) of each link. A copy of the database alone can't open orders.
- **Admin needs two-factor**, and only emails on the `ADMIN_EMAILS` list can get in.
- Stripe webhooks are signature-checked and safe to retry (a payment is never counted twice).
- Uploads are limited by type and size, and the file contents are checked.
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
2. Run the database setup: either install the [Supabase CLI](https://supabase.com/docs/guides/cli) and run `supabase link` then `supabase db push`, or paste `supabase/migrations/20261108000000_initial_schema.sql` into the SQL editor and run it.
3. Load the sample menu: paste `supabase/seed.sql` into the SQL editor and run it. (Regenerate it from `src/lib/data/sample-data.ts` with `npm run seed:sql` if you change the samples.)
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
4. The daily reminder job is set in `vercel.json` (22:00 UTC, which is 9am in Sydney during daylight saving and 8am otherwise). Vercel sends `CRON_SECRET` with each run.

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
- [ ] Written terms checked and entered in the admin (deposits, refunds, changes, cake care, rush and peak fees).
- [ ] Privacy policy and terms pages filled in (`src/app/privacy/page.tsx`, `src/app/terms/page.tsx`).
- [ ] Real prices, notice period, capacity, pickup hours and pickup details (`PICKUP_DETAILS`).
- [ ] Original high-resolution photos for the home page.
- [ ] ABN on the terms page and in Stripe.

## For developers

```bash
npm run dev         # local server
npm run lint        # ESLint
npm run typecheck   # route types + TypeScript
npm test            # unit tests (Vitest), including the SQL migration on PGlite
npm run test:e2e    # end-to-end tests (Playwright) on a production build in test mode
npm run build       # production build
```

- `src/lib/domain`: pure business rules (pricing, availability, slots, rush and peak, visibility). Most of the logic lives here and is unit tested.
- `src/lib/data`: the data adapter. `supabase.ts` for the live site, `memory.ts` for tests (`DATA_ADAPTER=memory`).
- `src/lib/services`: order workflows, Stripe, email and private link tokens.
- `src/app`: pages and API routes. Emily's admin is under `src/app/admin`.
- `supabase/migrations`: the database schema, Row Level Security and the exactly-once payment function.
- The business name lives in `src/lib/config.ts` if Emily picks a different brand.

**What the automated tests cover, and what they don't.** Unit tests run the real pricing, calendar and order code, the real SQL migration on PGlite (Postgres in WebAssembly, with small stand-ins for Supabase's auth and storage), and the real Stripe webhook route with Stripe's own signature tools. End-to-end tests drive a production build in a real browser on the in-memory adapter with a pretend checkout. **Nothing has been tested against live Supabase, Stripe or Resend accounts yet.** Do that with test keys before launch (steps 2 to 6 above).
