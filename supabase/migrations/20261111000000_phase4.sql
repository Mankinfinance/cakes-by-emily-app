-- Cakes by Emily: phase 4.
-- Split payments and guest details for private classes, class photo
-- galleries, the 3-class pass, vouchers on classes / boxes / corporate
-- orders, customer cancellation of class bookings, automated Stripe refunds
-- (behind a setting), and an atomic stamp card reward claim.
-- Same rules as before: Row Level Security on every table, the website's
-- server writes with the service role, and Emily's admin login can read in
-- the Supabase dashboard (with two-factor).

-- Private classes: share link, nudges, cancellation ----------------------------
alter table public.private_requests drop constraint if exists private_requests_status_check;
alter table public.private_requests add constraint private_requests_status_check
  check (status in ('requested','accepted','declined','paid','cancelled'));
alter table public.private_requests
  -- SHA-256 of the guests' share link token. The token is only ever emailed.
  add column share_token_hash text unique,
  add column last_nudge_at timestamptz,
  add column cancellation jsonb;

-- One row per guest place, with its share of the balance.
create table public.private_guests (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.private_requests (id) on delete cascade,
  slot integer not null check (slot between 1 and 50),
  name text not null default '' check (char_length(name) <= 80),
  email text not null default '' check (char_length(email) <= 120),
  allergies text not null default '' check (char_length(allergies) <= 300),
  dietary text[] not null default '{}',
  message_opt_in boolean not null default false,
  share_cents integer not null check (share_cents >= 0),
  status text not null default 'open' check (status in ('open','paid')),
  hold_key uuid,
  hold_until timestamptz,
  paid_at timestamptz,
  details_at timestamptz,
  unique (request_id, slot)
);
create index private_guests_hold_idx on public.private_guests (hold_key);
alter table public.private_guests enable row level security;
create policy "admins read private guests" on public.private_guests
  for select to authenticated using (public.is_admin());

-- Class photo galleries ------------------------------------------------------------
create table public.class_photos (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  path text not null unique check (path ~ '^classes/[0-9a-f-]{36}/photo-[0-9a-f-]{36}\.(jpg|png|webp|heic)$'),
  caption text not null default '' check (char_length(caption) <= 200),
  created_at timestamptz not null default now()
);
create index class_photos_session_idx on public.class_photos (session_id, created_at);
alter table public.class_photos enable row level security;
create policy "admins read class photos" on public.class_photos
  for select to authenticated using (public.is_admin());

-- 3-class passes ---------------------------------------------------------------------
create table public.class_passes (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 of the normalised code, plus the last 4 characters for display.
  code_hash text not null unique,
  code_last4 text not null check (char_length(code_last4) = 4),
  credits_total integer not null check (credits_total between 1 and 20),
  credits_left integer not null default 0 check (credits_left >= 0),
  status text not null default 'pending' check (status in ('pending','active','void')),
  buyer_name text not null default '',
  buyer_email text not null,
  expires_on date not null,
  created_at timestamptz not null default now(),
  constraint class_passes_left_le_total check (credits_left <= credits_total)
);
alter table public.class_passes enable row level security;
create policy "admins read class passes" on public.class_passes
  for select to authenticated using (public.is_admin());

create table public.pass_redemptions (
  id bigint generated always as identity primary key,
  pass_id uuid not null references public.class_passes (id) on delete cascade,
  booking_id uuid references public.class_bookings (id) on delete set null,
  credits integer not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index pass_redemptions_booking_idx on public.pass_redemptions (booking_id);
alter table public.pass_redemptions enable row level security;
create policy "admins read pass redemptions" on public.pass_redemptions
  for select to authenticated using (public.is_admin());

-- Vouchers and passes on classes, boxes and corporate orders ------------------------
alter table public.class_bookings
  add column pass_id uuid references public.class_passes (id) on delete set null,
  add column pass_credits integer not null default 0 check (pass_credits >= 0),
  add column voucher_id uuid references public.vouchers (id) on delete set null,
  add column voucher_applied_cents integer not null default 0 check (voucher_applied_cents >= 0);
alter table public.box_orders
  add column voucher_id uuid references public.vouchers (id) on delete set null,
  add column voucher_applied_cents integer not null default 0 check (voucher_applied_cents >= 0);
alter table public.corporate_orders
  add column voucher_id uuid references public.vouchers (id) on delete set null,
  add column voucher_applied_cents integer not null default 0 check (voucher_applied_cents >= 0);
alter table public.voucher_redemptions
  add column box_order_id uuid references public.box_orders (id) on delete set null,
  add column corporate_order_id uuid references public.corporate_orders (id) on delete set null,
  add column class_booking_id uuid references public.class_bookings (id) on delete set null;

-- Payments: passes, guest shares, PaymentIntents and refunds -------------------------
alter table public.payments
  add column pass_id uuid references public.class_passes (id) on delete cascade,
  add column share_hold_key uuid,
  add column stripe_payment_intent text,
  add column refunded_cents integer not null default 0 check (refunded_cents >= 0);
create index payments_intent_idx on public.payments (stripe_payment_intent);
alter table public.payments add constraint payments_refund_le_amount check (refunded_cents <= amount_cents);
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check
  check (kind in ('deposit','balance','box','voucher','corporate_deposit','corporate_balance','class','private_deposit','private_share','pass'));
alter table public.payments drop constraint if exists payments_one_target;
alter table public.payments add constraint payments_one_target check (
  (order_id is not null)::int + (box_order_id is not null)::int + (voucher_id is not null)::int
  + (corporate_order_id is not null)::int + (class_booking_id is not null)::int + (private_request_id is not null)::int
  + (pass_id is not null)::int = 1
);

-- Refunds made through Stripe (only when Emily turns automated refunds on).
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  stripe_refund_id text unique,
  status text not null check (status in ('succeeded','failed')),
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
create index refunds_payment_idx on public.refunds (payment_id);
alter table public.refunds enable row level security;
create policy "admins read refunds" on public.refunds
  for select to authenticated using (public.is_admin());

-- Stamp card rewards: one row per reward used. The unique key means two
-- orders placed at the same moment can't both use the same reward.
create table public.stamp_rewards (
  email text not null check (email = lower(email)),
  n integer not null check (n >= 1),
  order_id uuid not null unique,
  created_at timestamptz not null default now(),
  primary key (email, n)
);
alter table public.stamp_rewards enable row level security;
create policy "admins read stamp rewards" on public.stamp_rewards
  for select to authenticated using (public.is_admin());

-- Functions (service role only) ----------------------------------------------------

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
           status = case when status = 'accepted' and v_payment.kind = 'private_deposit' then 'paid' else status end
     where id = v_payment.private_request_id;
    if v_payment.kind = 'private_share' and v_payment.share_hold_key is not null then
      update public.private_guests
         set status = 'paid', paid_at = now()
       where request_id = v_payment.private_request_id
         and hold_key = v_payment.share_hold_key
         and status = 'open';
    end if;
  elsif v_payment.pass_id is not null then
    update public.class_passes
       set status = 'active', credits_left = credits_total
     where id = v_payment.pass_id and status = 'pending';
  end if;
  return true;
end;
$$;
revoke all on function public.record_payment_once(text, text) from public, anon, authenticated;

-- A guest adds their details: they take the first empty place, or null if all are taken.
create or replace function public.claim_guest_slot(
  p_request_id uuid, p_name text, p_email text, p_allergies text, p_dietary text[], p_opt_in boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.private_guests
   where request_id = p_request_id and name = ''
   order by slot
   limit 1
   for update skip locked;
  if v_id is null then
    return null;
  end if;
  update public.private_guests
     set name = p_name, email = p_email, allergies = p_allergies, dietary = p_dietary,
         message_opt_in = p_opt_in, details_at = now()
   where id = v_id;
  return v_id;
end;
$$;
revoke all on function public.claim_guest_slot(uuid, text, text, text, text[], boolean) from public, anon, authenticated;

-- Holds places for one checkout. All or nothing: false if any place is paid
-- or held by someone else's checkout that hasn't expired.
create or replace function public.hold_shares(p_ids uuid[], p_key uuid, p_until timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform 1 from public.private_guests where id = any(p_ids) order by id for update;
  select count(*) into v_count from public.private_guests
   where id = any(p_ids)
     and status = 'open'
     and (hold_key is null or hold_until is null or hold_until <= now());
  if v_count <> coalesce(array_length(p_ids, 1), 0) or v_count = 0 then
    return false;
  end if;
  update public.private_guests set hold_key = p_key, hold_until = p_until where id = any(p_ids);
  return true;
end;
$$;
revoke all on function public.hold_shares(uuid[], uuid, timestamptz) from public, anon, authenticated;

-- Vouchers on class bookings, box orders and corporate orders: same rules
-- as cake orders (redeem_voucher / return_voucher in phase 2).
create or replace function public.redeem_voucher_for(p_kind text, p_code_hash text, p_target uuid, p_max_cents integer, p_today date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vouchers%rowtype;
  v_amount integer;
  v_used uuid;
begin
  if p_max_cents <= 0 or p_kind not in ('box', 'corporate', 'booking') then
    return 0;
  end if;
  select * into v from public.vouchers where code_hash = p_code_hash for update;
  if not found or v.status <> 'active' or v.expires_on < p_today or v.balance_cents <= 0 then
    return 0;
  end if;
  if p_kind = 'box' then
    select voucher_id into v_used from public.box_orders where id = p_target for update;
    if not found or v_used is not null then return 0; end if;
  elsif p_kind = 'corporate' then
    select voucher_id into v_used from public.corporate_orders where id = p_target for update;
    if not found or v_used is not null then return 0; end if;
  else
    select voucher_id into v_used from public.class_bookings where id = p_target for update;
    if not found or v_used is not null then return 0; end if;
  end if;
  v_amount := least(v.balance_cents, p_max_cents);
  update public.vouchers set balance_cents = balance_cents - v_amount where id = v.id;
  if p_kind = 'box' then
    insert into public.voucher_redemptions (voucher_id, box_order_id, amount_cents, note) values (v.id, p_target, v_amount, 'used');
    update public.box_orders set voucher_id = v.id, voucher_applied_cents = v_amount where id = p_target;
  elsif p_kind = 'corporate' then
    insert into public.voucher_redemptions (voucher_id, corporate_order_id, amount_cents, note) values (v.id, p_target, v_amount, 'used');
    update public.corporate_orders set voucher_id = v.id, voucher_applied_cents = v_amount where id = p_target;
  else
    insert into public.voucher_redemptions (voucher_id, class_booking_id, amount_cents, note) values (v.id, p_target, v_amount, 'used');
    update public.class_bookings set voucher_id = v.id, voucher_applied_cents = v_amount where id = p_target;
  end if;
  return v_amount;
end;
$$;
revoke all on function public.redeem_voucher_for(text, text, uuid, integer, date) from public, anon, authenticated;

create or replace function public.return_voucher_for(p_kind text, p_target uuid, p_today date)
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
  if p_kind = 'box' then
    select voucher_id into v_voucher from public.box_orders where id = p_target for update;
    select coalesce(sum(amount_cents), 0) into v_net from public.voucher_redemptions where box_order_id = p_target and voucher_id = v_voucher;
  elsif p_kind = 'corporate' then
    select voucher_id into v_voucher from public.corporate_orders where id = p_target for update;
    select coalesce(sum(amount_cents), 0) into v_net from public.voucher_redemptions where corporate_order_id = p_target and voucher_id = v_voucher;
  elsif p_kind = 'booking' then
    select voucher_id into v_voucher from public.class_bookings where id = p_target for update;
    select coalesce(sum(amount_cents), 0) into v_net from public.voucher_redemptions where class_booking_id = p_target and voucher_id = v_voucher;
  end if;
  if v_voucher is null or coalesce(v_net, 0) <= 0 then
    return query select 0, false;
    return;
  end if;
  select * into v from public.vouchers where id = v_voucher for update;
  if v.status = 'active' and v.expires_on >= p_today then
    update public.vouchers set balance_cents = least(amount_cents, balance_cents + v_net) where id = v.id;
  end if;
  if p_kind = 'box' then
    insert into public.voucher_redemptions (voucher_id, box_order_id, amount_cents, note) values (v.id, p_target, -v_net, 'returned');
  elsif p_kind = 'corporate' then
    insert into public.voucher_redemptions (voucher_id, corporate_order_id, amount_cents, note) values (v.id, p_target, -v_net, 'returned');
  else
    insert into public.voucher_redemptions (voucher_id, class_booking_id, amount_cents, note) values (v.id, p_target, -v_net, 'returned');
  end if;
  return query select v_net, (v.status = 'active' and v.expires_on >= p_today);
end;
$$;
revoke all on function public.return_voucher_for(text, uuid, date) from public, anon, authenticated;

-- Uses up to p_max credits of a pass on a booking, once per booking. Returns the credits used.
create or replace function public.redeem_pass(p_code_hash text, p_booking uuid, p_max integer, p_today date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.class_passes%rowtype;
  v_used uuid;
  v_n integer;
begin
  if p_max <= 0 then
    return 0;
  end if;
  select * into p from public.class_passes where code_hash = p_code_hash for update;
  if not found or p.status <> 'active' or p.expires_on < p_today or p.credits_left <= 0 then
    return 0;
  end if;
  select pass_id into v_used from public.class_bookings where id = p_booking for update;
  if not found or v_used is not null then
    return 0;
  end if;
  v_n := least(p.credits_left, p_max);
  update public.class_passes set credits_left = credits_left - v_n where id = p.id;
  insert into public.pass_redemptions (pass_id, booking_id, credits, note) values (p.id, p_booking, v_n, 'used');
  update public.class_bookings set pass_id = p.id, pass_credits = v_n where id = p_booking;
  return v_n;
end;
$$;
revoke all on function public.redeem_pass(text, uuid, integer, date) from public, anon, authenticated;

-- Gives a booking's pass credits back, once. An expired pass is extended by
-- 90 days so the credits can still be used.
create or replace function public.return_pass(p_booking uuid, p_today date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pass uuid;
  v_net integer;
begin
  select pass_id into v_pass from public.class_bookings where id = p_booking for update;
  if v_pass is null then
    return 0;
  end if;
  select coalesce(sum(credits), 0) into v_net from public.pass_redemptions where booking_id = p_booking and pass_id = v_pass;
  if v_net <= 0 then
    return 0;
  end if;
  update public.class_passes
     set credits_left = least(credits_total, credits_left + v_net),
         expires_on = greatest(expires_on, p_today + 90)
   where id = v_pass;
  insert into public.pass_redemptions (pass_id, booking_id, credits, note) values (v_pass, p_booking, -v_net, 'returned');
  return v_net;
end;
$$;
revoke all on function public.return_pass(uuid, date) from public, anon, authenticated;

-- Stripe's charge.refunded event, once per event. Refunds made in the Stripe
-- dashboard show up here too. amount_refunded is Stripe's running total.
create or replace function public.record_charge_refunded(p_event_id text, p_intent text, p_amount_refunded integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.stripe_events (id) values (p_event_id) on conflict do nothing;
  if not found then
    return false;
  end if;
  update public.payments
     set refunded_cents = least(amount_cents, greatest(refunded_cents, p_amount_refunded))
   where stripe_payment_intent = p_intent;
  return found;
end;
$$;
revoke all on function public.record_charge_refunded(text, text, integer) from public, anon, authenticated;

-- Claims the next unused stamp card reward (1..p_earned) for an order. Returns
-- the reward number, or 0 if none is left.
create or replace function public.claim_stamp_reward(p_email text, p_earned integer, p_order uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  i integer;
begin
  for i in 1..greatest(p_earned, 0) loop
    insert into public.stamp_rewards (email, n, order_id) values (lower(p_email), i, p_order) on conflict do nothing;
    if found then
      return i;
    end if;
  end loop;
  return 0;
end;
$$;
revoke all on function public.claim_stamp_reward(text, integer, uuid) from public, anon, authenticated;
