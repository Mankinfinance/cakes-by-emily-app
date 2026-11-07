-- Cakes by Emily: initial schema.
-- Customers never read these tables directly. The website's server talks to
-- the database with the service role key after its own checks, and Row Level
-- Security blocks everything else. Emily's admin login gets read access via
-- the is_admin() policies (with two-factor, aal2) for use in the Supabase dashboard.


-- Admins ----------------------------------------------------------------
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create policy "admins can see admins" on public.admins
  for select to authenticated using (public.is_admin());

-- Catalogue -------------------------------------------------------------
create table public.catalogue_items (
  id text primary key,
  category text not null check (category in ('occasion','size','flavour','finish','colour','decoration','extra')),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 200),
  price_cents integer not null default 0 check (price_cents >= 0 and price_cents <= 1000000),
  price_mode text not null default 'flat' check (price_mode in ('flat','per_tier')),
  tiers integer not null default 1 check (tiers between 1 and 6),
  hex text check (hex is null or hex ~ '^#[0-9A-Fa-f]{6}$'),
  allergens text[] not null default '{}',
  visible boolean not null default true,
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.catalogue_items enable row level security;
create policy "admins manage catalogue" on public.catalogue_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Settings (one row) ----------------------------------------------------
create table public.settings (
  id integer primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;
create policy "admins manage settings" on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.days_off (
  date date primary key,
  note text not null default ''
);
alter table public.days_off enable row level security;
create policy "admins manage days off" on public.days_off
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.peak_dates (
  date date primary key,
  label text not null default 'Peak date',
  surcharge_cents integer not null check (surcharge_cents >= 0)
);
alter table public.peak_dates enable row level security;
create policy "admins manage peak dates" on public.peak_dates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Orders ----------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  -- SHA-256 of the customer's private order link token. The token itself is never stored.
  token_hash text not null unique,
  stage text not null default 'awaiting_payment'
    check (stage in ('awaiting_payment','received','design_confirmed','baking','decorating','ready','collected','cancelled')),
  customer_name text not null,
  email text not null,
  phone text not null,
  marketing_opt_in boolean not null default false,
  pickup_date date not null,
  pickup_slot text not null check (pickup_slot ~ '^[0-2][0-9]:[0-5][0-9]$'),
  config jsonb not null,
  allergy_notes text not null default '',
  notes text not null default '',
  inspiration_path text,
  subtotal_cents integer not null,
  rush_fee_cents integer not null default 0,
  peak_surcharge_cents integer not null default 0,
  total_cents integer not null,
  deposit_cents integer not null,
  amount_paid_cents integer not null default 0,
  is_rush boolean not null default false,
  terms_accepted_at timestamptz not null,
  reminders_sent text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index orders_pickup_idx on public.orders (pickup_date, pickup_slot);
alter table public.orders enable row level security;
create policy "admins read orders" on public.orders
  for select to authenticated using (public.is_admin());

-- A snapshot of each priced line, so later price or visibility changes never alter an existing order.
create table public.order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  item_id text,
  category text not null,
  name text not null,
  amount_cents integer not null
);
create index order_items_order_idx on public.order_items (order_id);
alter table public.order_items enable row level security;
create policy "admins read order items" on public.order_items
  for select to authenticated using (public.is_admin());

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null check (kind in ('deposit','balance')),
  amount_cents integer not null check (amount_cents > 0),
  stripe_session_id text not null unique,
  status text not null default 'pending' check (status in ('pending','paid')),
  created_at timestamptz not null default now()
);
create index payments_order_idx on public.payments (order_id);
alter table public.payments enable row level security;
create policy "admins read payments" on public.payments
  for select to authenticated using (public.is_admin());

-- Stripe webhook events already handled, so retries never double count.
create table public.stripe_events (
  id text primary key,
  processed_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;

create table public.order_updates (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null check (kind in ('stage','photo','video','note')),
  caption text not null default '',
  media_path text,
  created_at timestamptz not null default now()
);
create index order_updates_order_idx on public.order_updates (order_id, created_at desc);
alter table public.order_updates enable row level security;
create policy "admins read updates" on public.order_updates
  for select to authenticated using (public.is_admin());

-- Records a paid Stripe session exactly once. Called by the webhook with the service role.
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
  update public.orders
     set amount_paid_cents = amount_paid_cents + v_payment.amount_cents,
         stage = case when stage = 'awaiting_payment' then 'received' else stage end
   where id = v_payment.order_id;
  return true;
end;
$$;
revoke all on function public.record_payment_once(text, text) from public, anon, authenticated;

-- Private storage bucket for inspiration photos and Emily's progress updates.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-media',
  'order-media',
  false,
  52428800,
  array['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime','video/webm']
)
on conflict (id) do nothing;
