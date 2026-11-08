-- Cakes by Emily: phase 3.
-- Corporate packages, reviews, referrals and the stamp card, party add-ons,
-- the sales snapshot, and Cake and Sip classes (with private group requests).
-- Same rules as before: Row Level Security on every table, the website's
-- server writes with the service role, and Emily's admin login can read in
-- the Supabase dashboard (with two-factor).

-- Party add-ons are catalogue items with an optional refundable bond -------
alter table public.catalogue_items drop constraint if exists catalogue_items_category_check;
alter table public.catalogue_items add constraint catalogue_items_category_check
  check (category in ('occasion','size','flavour','finish','colour','decoration','extra','addon'));
alter table public.catalogue_items
  add column bond_cents integer not null default 0 check (bond_cents >= 0 and bond_cents <= 100000);

-- Orders: referral code used and stamp card reward ---------------------------
alter table public.orders
  add column referral_code text,
  add column stamp_reward boolean not null default false;

-- New automatic messages --------------------------------------------------------
alter table public.automations drop constraint if exists automations_key_check;
alter table public.automations add constraint automations_key_check
  check (key in ('order_received','design_confirmed','balance_reminder','pickup_details','thank_you','rebook_reminder','stand_return','class_reminder','class_thank_you'));
insert into public.automations (key, enabled, days) values
  ('stand_return', true, 3),
  ('class_reminder', true, 1),
  ('class_thank_you', true, 1)
on conflict (key) do nothing;

-- Corporate packages ----------------------------------------------------------------
create table public.corporate_packages (
  id text primary key check (id ~ '^[a-z0-9-]{1,60}$'),
  product text not null check (product in ('cookies','cupcakes')),
  name text not null check (char_length(name) between 1 and 80),
  quantity integer not null check (quantity between 1 and 1000),
  price_cents integer not null check (price_cents between 0 and 1000000),
  visible boolean not null default true,
  sort integer not null default 0
);
alter table public.corporate_packages enable row level security;
create policy "admins manage corporate packages" on public.corporate_packages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.corporate_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  token_hash text not null unique,
  package_id text not null references public.corporate_packages (id),
  package_name text not null,
  quantity integer not null check (quantity > 0),
  total_cents integer not null check (total_cents >= 0),
  deposit_cents integer not null check (deposit_cents >= 0),
  amount_paid_cents integer not null default 0,
  company_name text not null check (char_length(company_name) between 1 and 120),
  abn text not null default '' check (abn = '' or abn ~ '^[0-9]{11}$'),
  contact_name text not null,
  email text not null,
  phone text not null,
  logo_path text,
  notes text not null default '' check (char_length(notes) <= 1000),
  pickup_date date not null,
  pickup_slot text not null check (pickup_slot ~ '^[0-2][0-9]:[0-5][0-9]$'),
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment','confirmed','ready','collected','cancelled')),
  kitchen_done boolean not null default false,
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index corporate_orders_pickup_idx on public.corporate_orders (pickup_date, pickup_slot);
alter table public.corporate_orders enable row level security;
create policy "admins read corporate orders" on public.corporate_orders
  for select to authenticated using (public.is_admin());

-- Reviews (one per order) ------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  text text not null default '' check (char_length(text) <= 1500),
  photo_path text,
  consent_to_publish boolean not null default false,
  display_name text not null check (char_length(display_name) between 1 and 40),
  status text not null default 'pending' check (status in ('pending','approved','hidden')),
  created_at timestamptz not null default now(),
  -- Only reviews the customer agreed to publish can be shown.
  constraint reviews_publish_needs_consent check (status <> 'approved' or consent_to_publish)
);
alter table public.reviews enable row level security;
create policy "admins read reviews" on public.reviews
  for select to authenticated using (public.is_admin());

-- Referrals ----------------------------------------------------------------------------
create table public.referral_codes (
  code text primary key check (code ~ '^[A-Z]{1,8}-[A-Z2-9]{4}$'),
  email text not null unique,
  created_at timestamptz not null default now()
);
alter table public.referral_codes enable row level security;
create policy "admins read referral codes" on public.referral_codes
  for select to authenticated using (public.is_admin());

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.referral_codes (code),
  referrer_email text not null,
  referred_email text not null,
  order_id uuid not null unique references public.orders (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','rewarded','void')),
  created_at timestamptz not null default now(),
  constraint referrals_not_self check (lower(referrer_email) <> lower(referred_email))
);
-- Each new customer can only be referred once (a voided referral frees them up again).
create unique index referrals_one_per_customer on public.referrals (lower(referred_email)) where status <> 'void';
alter table public.referrals enable row level security;
create policy "admins read referrals" on public.referrals
  for select to authenticated using (public.is_admin());

-- Classes ---------------------------------------------------------------------------------
create table public.class_types (
  id text primary key check (id ~ '^[a-z0-9-]{1,60}$'),
  name text not null check (char_length(name) between 1 and 100),
  description text not null default '' check (char_length(description) <= 500),
  level text not null default '',
  price_cents integer not null check (price_cents between 0 and 100000),
  duration_minutes integer not null check (duration_minutes between 15 and 600),
  default_seats integer not null check (default_seats between 1 and 50),
  min_guests integer not null default 1 check (min_guests between 1 and 50),
  is_sip boolean not null default false,
  age_note text not null default '',
  visible boolean not null default true,
  sort integer not null default 0
);
alter table public.class_types enable row level security;
create policy "admins manage class types" on public.class_types
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_type_id text not null references public.class_types (id),
  date date not null,
  start_time text not null check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  seats integer not null check (seats between 1 and 50),
  booked integer not null default 0 check (booked >= 0),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  series_id uuid,
  created_at timestamptz not null default now(),
  -- The database itself refuses to overbook.
  constraint class_sessions_not_overbooked check (booked <= seats)
);
create index class_sessions_date_idx on public.class_sessions (date);
alter table public.class_sessions enable row level security;
create policy "admins manage class sessions" on public.class_sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.class_bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  token_hash text not null unique,
  session_id uuid not null references public.class_sessions (id),
  seats integer not null check (seats between 1 and 6),
  guests jsonb not null,
  contact_name text not null,
  email text not null,
  phone text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  amount_paid_cents integer not null default 0,
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment','paid','cancelled')),
  adult_confirmed boolean not null default false,
  marketing_opt_in boolean not null default false,
  waitlist_id uuid references public.waitlist (id) on delete set null,
  cancellation jsonb,
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index class_bookings_session_idx on public.class_bookings (session_id);
alter table public.class_bookings enable row level security;
create policy "admins read class bookings" on public.class_bookings
  for select to authenticated using (public.is_admin());

create table public.booking_message_log (
  booking_id uuid not null references public.class_bookings (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 40),
  sent_at timestamptz not null default now(),
  primary key (booking_id, key)
);
alter table public.booking_message_log enable row level security;
create policy "admins read booking messages" on public.booking_message_log
  for select to authenticated using (public.is_admin());

create table public.private_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  package_key text not null,
  package_name text not null,
  guests integer not null check (guests between 1 and 50),
  per_person_cents integer not null check (per_person_cents >= 0),
  deposit_cents integer not null check (deposit_cents >= 0),
  estimate_cents integer not null check (estimate_cents >= 0),
  preferred_date date not null,
  preferred_time text not null check (preferred_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  occasion text not null default '' check (char_length(occasion) <= 80),
  contact_name text not null,
  email text not null,
  phone text not null,
  notes text not null default '' check (char_length(notes) <= 1000),
  status text not null default 'requested' check (status in ('requested','accepted','declined','paid')),
  -- SHA-256 of the deposit payment link token, set when Emily accepts.
  pay_token_hash text unique,
  amount_paid_cents integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.private_requests enable row level security;
create policy "admins read private requests" on public.private_requests
  for select to authenticated using (public.is_admin());

-- The waitlist now also covers sold-out class sessions -------------------------------
alter table public.waitlist
  add column session_id uuid references public.class_sessions (id) on delete cascade,
  add column seats integer not null default 1 check (seats between 1 and 6);
drop index if exists public.waitlist_one_offer_per_date;
create unique index waitlist_one_offer_per_target on public.waitlist
  (date, coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'offered';

-- Payments can now be for corporate orders, class bookings and private deposits -------
alter table public.payments
  add column corporate_order_id uuid references public.corporate_orders (id) on delete cascade,
  add column class_booking_id uuid references public.class_bookings (id) on delete cascade,
  add column private_request_id uuid references public.private_requests (id) on delete cascade;
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check
  check (kind in ('deposit','balance','box','voucher','corporate_deposit','corporate_balance','class','private_deposit'));
alter table public.payments drop constraint if exists payments_one_target;
alter table public.payments add constraint payments_one_target check (
  (order_id is not null)::int + (box_order_id is not null)::int + (voucher_id is not null)::int
  + (corporate_order_id is not null)::int + (class_booking_id is not null)::int + (private_request_id is not null)::int = 1
);

-- Functions (service role only) -------------------------------------------------------------

create or replace function public.record_payment_once(p_event_id text, p_session_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
begin
  insert into public.stripe_events (id) values (p_event_id) on conflict do nothing;
  if not found then
    return false;
  end if;

  select * into v_payment from public.payments
   where stripe_session_id = p_session_id
   for update;
  if not found or v_payment.status = 'paid' then
    return false;
  end if;

  update public.payments set status = 'paid' where id = v_payment.id;

  if v_payment.order_id is not null then
    update public.orders
       set amount_paid_cents = amount_paid_cents + v_payment.amount_cents,
           stage = case when stage = 'awaiting_payment' then 'received' else stage end
     where id = v_payment.order_id;
  elsif v_payment.box_order_id is not null then
    update public.box_orders
       set amount_paid_cents = amount_paid_cents + v_payment.amount_cents,
           status = case when status = 'awaiting_payment' then 'paid' else status end
     where id = v_payment.box_order_id;
  elsif v_payment.voucher_id is not null then
    update public.vouchers
       set status = 'active', balance_cents = amount_cents
     where id = v_payment.voucher_id and status = 'pending';
  elsif v_payment.corporate_order_id is not null then
    update public.corporate_orders
       set amount_paid_cents = amount_paid_cents + v_payment.amount_cents,
           status = case when status = 'awaiting_payment' then 'confirmed' else status end
     where id = v_payment.corporate_order_id;
  elsif v_payment.class_booking_id is not null then
    update public.class_bookings
       set amount_paid_cents = amount_paid_cents + v_payment.amount_cents,
           status = case when status = 'awaiting_payment' then 'paid' else status end
     where id = v_payment.class_booking_id;
  elsif v_payment.private_request_id is not null then
    update public.private_requests
       set amount_paid_cents = amount_paid_cents + v_payment.amount_cents,
           status = case when status = 'accepted' then 'paid' else status end
     where id = v_payment.private_request_id;
  end if;
  return true;
end;
$$;
revoke all on function public.record_payment_once(text, text) from public, anon, authenticated;

-- Takes seats in a class, or returns false. The row lock means two people
-- booking the last seats at the same moment can't both get them.
create or replace function public.reserve_class_seats(p_session_id uuid, p_seats integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_seats < 1 then
    return false;
  end if;
  update public.class_sessions
     set booked = booked + p_seats
   where id = p_session_id
     and status = 'scheduled'
     and booked + p_seats <= seats;
  return found;
end;
$$;
revoke all on function public.reserve_class_seats(uuid, integer) from public, anon, authenticated;

create or replace function public.release_class_seats(p_session_id uuid, p_seats integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.class_sessions set booked = greatest(0, booked - p_seats) where id = p_session_id;
$$;
revoke all on function public.release_class_seats(uuid, integer) from public, anon, authenticated;

-- Cancels a booking once and gives its seats back.
create or replace function public.cancel_class_booking(p_booking_id uuid, p_only_unpaid boolean, p_record jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session uuid;
  v_seats integer;
begin
  update public.class_bookings
     set status = 'cancelled', cancellation = p_record
   where id = p_booking_id
     and status in ('awaiting_payment', 'paid')
     and (not p_only_unpaid or status = 'awaiting_payment')
  returning session_id, seats into v_session, v_seats;
  if not found then
    return false;
  end if;
  update public.class_sessions set booked = greatest(0, booked - v_seats) where id = v_session;
  return true;
end;
$$;
revoke all on function public.cancel_class_booking(uuid, boolean, jsonb) from public, anon, authenticated;

-- The sales snapshot's money and counts, by the Sydney date each order was booked.
create or replace function public.sales_summary(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with booked as (
    select o.id, o.total_cents
      from public.orders o
     where o.stage not in ('awaiting_payment', 'cancelled')
       and (o.created_at at time zone 'Australia/Sydney')::date between p_from and p_to
  ),
  items as (
    select i.category, i.name, count(*)::int as n
      from public.order_items i
      join booked b on b.id = i.order_id
     where i.category in ('flavour', 'finish', 'occasion')
     group by i.category, i.name
  ),
  ranked as (
    select category, name, n,
           row_number() over (partition by category order by n desc, name asc) as r
      from items
  )
  select jsonb_build_object(
    'orders', (select count(*) from booked),
    'revenueCents', (select coalesce(sum(total_cents), 0) from booked),
    'depositsCents', (
      select coalesce(sum(p.amount_cents), 0) from public.payments p
       where p.status = 'paid' and p.kind = 'deposit'
         and (p.created_at at time zone 'Australia/Sydney')::date between p_from and p_to
    ),
    'topFlavours', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', n) order by r) from ranked where category = 'flavour' and r <= 5), '[]'::jsonb),
    'topFinishes', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', n) order by r) from ranked where category = 'finish' and r <= 5), '[]'::jsonb),
    'topOccasions', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', n) order by r) from ranked where category = 'occasion' and r <= 5), '[]'::jsonb)
  );
$$;
revoke all on function public.sales_summary(date, date) from public, anon, authenticated;
