-- Cakes by Emily: phase 2.
-- Automatic messages, design approval, waitlist, kitchen sheet, change and
-- cancel with terms, seasonal boxes, gift vouchers and credit codes.
-- Same rules as the initial schema: Row Level Security on every table, the
-- website's server writes with the service role, and Emily's admin login can
-- read in the Supabase dashboard (with two-factor).

-- Orders: new stage and columns ------------------------------------------
alter table public.orders drop constraint if exists orders_stage_check;
alter table public.orders add constraint orders_stage_check
  check (stage in ('awaiting_payment','received','awaiting_approval','design_confirmed','baking','decorating','ready','collected','cancelled'));

alter table public.orders
  add column dietary text[] not null default '{}',
  add column remind_next_year boolean not null default false,
  add column date_changes_used integer not null default 0 check (date_changes_used >= 0),
  add column design_changes_used integer not null default 0 check (design_changes_used >= 0),
  add column approved_at timestamptz,
  add column voucher_id uuid,
  add column voucher_applied_cents integer not null default 0 check (voucher_applied_cents >= 0),
  add column waitlist_id uuid,
  add column kitchen_done boolean not null default false,
  add column cancellation jsonb;

alter table public.order_updates drop constraint if exists order_updates_kind_check;
alter table public.order_updates add constraint order_updates_kind_check
  check (kind in ('stage','photo','video','note','sketch','change_request','approval'));

-- Automatic messages ------------------------------------------------------
create table public.automations (
  key text primary key check (key in ('order_received','design_confirmed','balance_reminder','pickup_details','thank_you','rebook_reminder')),
  enabled boolean not null default true,
  days integer not null default 0 check (days between 0 and 400)
);
alter table public.automations enable row level security;
create policy "admins manage automations" on public.automations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.automations (key, enabled, days) values
  ('order_received', true, 0),
  ('design_confirmed', true, 0),
  ('balance_reminder', true, 4),
  ('pickup_details', true, 1),
  ('thank_you', true, 1),
  ('rebook_reminder', true, 335)
on conflict (key) do nothing;

-- One row per message sent. The primary key is what stops a double send:
-- the server claims the row before sending and removes it if the send fails.
create table public.message_log (
  order_id uuid not null references public.orders (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 40),
  sent_at timestamptz not null default now(),
  primary key (order_id, key)
);
alter table public.message_log enable row level security;
create policy "admins read message log" on public.message_log
  for select to authenticated using (public.is_admin());

-- Waitlist ------------------------------------------------------------------
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  customer_name text not null check (char_length(customer_name) between 2 and 80),
  email text not null check (char_length(email) <= 120),
  phone text not null check (char_length(phone) <= 20),
  config jsonb not null,
  dietary text[] not null default '{}',
  status text not null default 'waiting' check (status in ('waiting','offered','claimed','expired','removed')),
  -- SHA-256 of the claim link token. The token itself is only ever emailed.
  offer_token_hash text unique,
  offered_at timestamptz,
  offer_expires_at timestamptz,
  order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now()
);
create index waitlist_date_idx on public.waitlist (date, status, created_at);
-- Only one live offer per date at a time.
create unique index waitlist_one_offer_per_date on public.waitlist (date) where status = 'offered';
alter table public.waitlist enable row level security;
create policy "admins read waitlist" on public.waitlist
  for select to authenticated using (public.is_admin());

alter table public.orders add constraint orders_waitlist_fk
  foreign key (waitlist_id) references public.waitlist (id) on delete set null;

-- Seasonal boxes --------------------------------------------------------------
create table public.seasonal_boxes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  price_cents integer not null check (price_cents between 100 and 100000),
  cap integer not null check (cap >= 0),
  sold integer not null default 0 check (sold >= 0),
  opens_on date not null,
  closes_on date not null,
  pickup_from date not null,
  pickup_to date not null,
  photo_path text,
  visible boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  -- The database itself refuses to oversell.
  constraint seasonal_boxes_not_oversold check (sold <= cap),
  constraint seasonal_boxes_dates check (opens_on <= closes_on and pickup_from <= pickup_to)
);
alter table public.seasonal_boxes enable row level security;
create policy "admins manage boxes" on public.seasonal_boxes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.box_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  token_hash text not null unique,
  box_id uuid not null references public.seasonal_boxes (id),
  box_name text not null,
  quantity integer not null check (quantity between 1 and 10),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  amount_paid_cents integer not null default 0,
  customer_name text not null,
  email text not null,
  phone text not null,
  marketing_opt_in boolean not null default false,
  pickup_date date not null,
  pickup_slot text not null check (pickup_slot ~ '^[0-2][0-9]:[0-5][0-9]$'),
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment','paid','collected','cancelled')),
  kitchen_done boolean not null default false,
  created_at timestamptz not null default now()
);
create index box_orders_pickup_idx on public.box_orders (pickup_date, pickup_slot);
alter table public.box_orders enable row level security;
create policy "admins read box orders" on public.box_orders
  for select to authenticated using (public.is_admin());

-- Gift vouchers and credit codes ------------------------------------------------
create table public.vouchers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('gift','credit')),
  -- SHA-256 of the normalised code, plus the last 4 characters for display.
  code_hash text not null unique,
  code_last4 text not null check (char_length(code_last4) = 4),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000),
  balance_cents integer not null default 0 check (balance_cents >= 0),
  status text not null default 'pending' check (status in ('pending','active','void')),
  buyer_name text not null default '',
  buyer_email text not null,
  recipient_name text not null default '',
  recipient_email text not null default '',
  message text not null default '' check (char_length(message) <= 300),
  expires_on date not null,
  source_order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint vouchers_balance_le_amount check (balance_cents <= amount_cents)
);
create index vouchers_email_idx on public.vouchers (buyer_email);
alter table public.vouchers enable row level security;
create policy "admins read vouchers" on public.vouchers
  for select to authenticated using (public.is_admin());

alter table public.orders add constraint orders_voucher_fk
  foreign key (voucher_id) references public.vouchers (id) on delete set null;

-- Every use (positive) and every amount given back (negative).
create table public.voucher_redemptions (
  id bigint generated always as identity primary key,
  voucher_id uuid not null references public.vouchers (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  amount_cents integer not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index voucher_redemptions_voucher_idx on public.voucher_redemptions (voucher_id);
alter table public.voucher_redemptions enable row level security;
create policy "admins read voucher redemptions" on public.voucher_redemptions
  for select to authenticated using (public.is_admin());

-- Payments now cover cake orders, box orders and voucher purchases -------------
alter table public.payments alter column order_id drop not null;
alter table public.payments
  add column box_order_id uuid references public.box_orders (id) on delete cascade,
  add column voucher_id uuid references public.vouchers (id) on delete cascade;
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in ('deposit','balance','box','voucher'));
alter table public.payments add constraint payments_one_target check (
  (order_id is not null)::int + (box_order_id is not null)::int + (voucher_id is not null)::int = 1
);

-- Functions (service role only) --------------------------------------------------

-- Records a paid Stripe session exactly once, whatever it paid for.
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
  end if;
  return true;
end;
$$;
revoke all on function public.record_payment_once(text, text) from public, anon, authenticated;

-- Takes stock for a box order, or returns false. The row lock means two
-- customers buying the last box at the same moment can't both get it.
create or replace function public.reserve_box_stock(p_box_id uuid, p_qty integer, p_today date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_qty < 1 then
    return false;
  end if;
  update public.seasonal_boxes
     set sold = sold + p_qty
   where id = p_box_id
     and visible
     and opens_on <= p_today
     and closes_on >= p_today
     and sold + p_qty <= cap;
  return found;
end;
$$;
revoke all on function public.reserve_box_stock(uuid, integer, date) from public, anon, authenticated;

-- Cancels an unpaid (or any not-yet-collected) box order and puts its stock back, once.
create or replace function public.cancel_box_order(p_box_order_id uuid, p_only_unpaid boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box uuid;
  v_qty integer;
begin
  update public.box_orders
     set status = 'cancelled'
   where id = p_box_order_id
     and status in ('awaiting_payment', 'paid')
     and (not p_only_unpaid or status = 'awaiting_payment')
  returning box_id, quantity into v_box, v_qty;
  if not found then
    return false;
  end if;
  update public.seasonal_boxes set sold = greatest(0, sold - v_qty) where id = v_box;
  return true;
end;
$$;
revoke all on function public.cancel_box_order(uuid, boolean) from public, anon, authenticated;

-- Uses up to p_max_cents of a voucher on an order, once per order. Returns the amount used (0 if none).
create or replace function public.redeem_voucher(p_code_hash text, p_order_id uuid, p_max_cents integer, p_today date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vouchers%rowtype;
  v_amount integer;
begin
  if p_max_cents <= 0 then
    return 0;
  end if;
  select * into v from public.vouchers
   where code_hash = p_code_hash
   for update;
  if not found or v.status <> 'active' or v.expires_on < p_today or v.balance_cents <= 0 then
    return 0;
  end if;
  if exists (select 1 from public.orders where id = p_order_id and voucher_id is not null) then
    return 0;
  end if;
  v_amount := least(v.balance_cents, p_max_cents);
  update public.vouchers set balance_cents = balance_cents - v_amount where id = v.id;
  insert into public.voucher_redemptions (voucher_id, order_id, amount_cents, note) values (v.id, p_order_id, v_amount, 'used');
  update public.orders set voucher_id = v.id, voucher_applied_cents = v_amount where id = p_order_id;
  return v_amount;
end;
$$;
revoke all on function public.redeem_voucher(text, uuid, integer, date) from public, anon, authenticated;

-- Gives back what an order used, once. If the voucher is still valid the
-- balance goes back on it (to_voucher = true); otherwise the caller issues a
-- new credit code for `amount`.
create or replace function public.return_voucher(p_order_id uuid, p_today date)
returns table (amount integer, to_voucher boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher uuid;
  v_net integer;
  v public.vouchers%rowtype;
begin
  select voucher_id into v_voucher from public.orders where id = p_order_id for update;
  if v_voucher is null then
    return query select 0, false;
    return;
  end if;
  select coalesce(sum(amount_cents), 0) into v_net from public.voucher_redemptions
   where order_id = p_order_id and voucher_id = v_voucher;
  if v_net <= 0 then
    return query select 0, false;
    return;
  end if;
  select * into v from public.vouchers where id = v_voucher for update;
  if v.status = 'active' and v.expires_on >= p_today then
    update public.vouchers set balance_cents = least(amount_cents, balance_cents + v_net) where id = v.id;
    insert into public.voucher_redemptions (voucher_id, order_id, amount_cents, note) values (v.id, p_order_id, -v_net, 'returned');
    return query select v_net, true;
  else
    insert into public.voucher_redemptions (voucher_id, order_id, amount_cents, note) values (v.id, p_order_id, -v_net, 'reissued as new credit');
    return query select v_net, false;
  end if;
end;
$$;
revoke all on function public.return_voucher(uuid, date) from public, anon, authenticated;
