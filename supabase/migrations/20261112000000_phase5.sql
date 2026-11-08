-- Layered by Cakes by Emily: phase 5.
-- Codes (gift vouchers, credit codes, class pass credits) on a private class
-- guest's own share, and cancelling some seats of a class booking.
-- Guests editing their details and automatic refunds of late payments need
-- no new tables. Same rules as before: Row Level Security stays on, the
-- website's server writes with the service role, and every function below
-- is closed to customers (anon) and logged-in users.

-- Codes on private class shares ------------------------------------------------------
alter table public.private_guests
  add column voucher_id uuid references public.vouchers (id) on delete set null,
  add column voucher_applied_cents integer not null default 0 check (voucher_applied_cents >= 0),
  add column pass_id uuid references public.class_passes (id) on delete set null,
  add column pass_applied_cents integer not null default 0 check (pass_applied_cents >= 0),
  add constraint private_guests_one_code check (voucher_id is null or pass_id is null),
  add constraint private_guests_codes_le_share check (voucher_applied_cents + pass_applied_cents <= share_cents);

alter table public.voucher_redemptions
  add column private_guest_id uuid references public.private_guests (id) on delete set null;
alter table public.pass_redemptions
  add column private_guest_id uuid references public.private_guests (id) on delete set null;
create index pass_redemptions_guest_idx on public.pass_redemptions (private_guest_id);

-- Partial cancellations of class bookings ---------------------------------------------
alter table public.class_bookings
  add column partial_cancellations jsonb not null default '[]'::jsonb;

-- Vouchers: the phase 4 function, now also for a guest's share ('share').
-- A share takes a code only while it is open and not held by a checkout.
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
  g public.private_guests%rowtype;
begin
  if p_max_cents <= 0 or p_kind not in ('box', 'corporate', 'booking', 'share') then
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
  elsif p_kind = 'booking' then
    select voucher_id into v_used from public.class_bookings where id = p_target for update;
    if not found or v_used is not null then return 0; end if;
  else
    select * into g from public.private_guests where id = p_target for update;
    if not found or g.status <> 'open' or g.voucher_id is not null or g.pass_id is not null
       or (g.hold_key is not null and g.hold_until is not null and g.hold_until > now()) then
      return 0;
    end if;
    p_max_cents := least(p_max_cents, g.share_cents - g.voucher_applied_cents - g.pass_applied_cents);
    if p_max_cents <= 0 then return 0; end if;
  end if;
  v_amount := least(v.balance_cents, p_max_cents);
  update public.vouchers set balance_cents = balance_cents - v_amount where id = v.id;
  if p_kind = 'box' then
    insert into public.voucher_redemptions (voucher_id, box_order_id, amount_cents, note) values (v.id, p_target, v_amount, 'used');
    update public.box_orders set voucher_id = v.id, voucher_applied_cents = v_amount where id = p_target;
  elsif p_kind = 'corporate' then
    insert into public.voucher_redemptions (voucher_id, corporate_order_id, amount_cents, note) values (v.id, p_target, v_amount, 'used');
    update public.corporate_orders set voucher_id = v.id, voucher_applied_cents = v_amount where id = p_target;
  elsif p_kind = 'booking' then
    insert into public.voucher_redemptions (voucher_id, class_booking_id, amount_cents, note) values (v.id, p_target, v_amount, 'used');
    update public.class_bookings set voucher_id = v.id, voucher_applied_cents = v_amount where id = p_target;
  else
    insert into public.voucher_redemptions (voucher_id, private_guest_id, amount_cents, note) values (v.id, p_target, v_amount, 'used');
    update public.private_guests set voucher_id = v.id, voucher_applied_cents = v_amount where id = p_target;
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
  elsif p_kind = 'share' then
    select voucher_id into v_voucher from public.private_guests where id = p_target for update;
    select coalesce(sum(amount_cents), 0) into v_net from public.voucher_redemptions where private_guest_id = p_target and voucher_id = v_voucher;
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
  elsif p_kind = 'booking' then
    insert into public.voucher_redemptions (voucher_id, class_booking_id, amount_cents, note) values (v.id, p_target, -v_net, 'returned');
  else
    insert into public.voucher_redemptions (voucher_id, private_guest_id, amount_cents, note) values (v.id, p_target, -v_net, 'returned');
  end if;
  return query select v_net, (v.status = 'active' and v.expires_on >= p_today);
end;
$$;
revoke all on function public.return_voucher_for(text, uuid, date) from public, anon, authenticated;

-- One class pass credit on a guest's share, worth up to p_value_cents. Once per share.
create or replace function public.redeem_pass_share(p_code_hash text, p_guest uuid, p_value_cents integer, p_today date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.class_passes%rowtype;
  g public.private_guests%rowtype;
  v_amount integer;
begin
  if p_value_cents <= 0 then
    return 0;
  end if;
  select * into p from public.class_passes where code_hash = p_code_hash for update;
  if not found or p.status <> 'active' or p.expires_on < p_today or p.credits_left <= 0 then
    return 0;
  end if;
  select * into g from public.private_guests where id = p_guest for update;
  if not found or g.status <> 'open' or g.voucher_id is not null or g.pass_id is not null
     or (g.hold_key is not null and g.hold_until is not null and g.hold_until > now()) then
    return 0;
  end if;
  v_amount := least(p_value_cents, g.share_cents - g.voucher_applied_cents - g.pass_applied_cents);
  if v_amount <= 0 then
    return 0;
  end if;
  update public.class_passes set credits_left = credits_left - 1 where id = p.id;
  insert into public.pass_redemptions (pass_id, private_guest_id, credits, note) values (p.id, p_guest, 1, 'used on a share');
  update public.private_guests set pass_id = p.id, pass_applied_cents = v_amount where id = p_guest;
  return v_amount;
end;
$$;
revoke all on function public.redeem_pass_share(text, uuid, integer, date) from public, anon, authenticated;

-- Gives a share's pass credit back, once (an expired pass gets 90 more days).
create or replace function public.return_pass_share(p_guest uuid, p_today date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pass uuid;
  v_net integer;
begin
  select pass_id into v_pass from public.private_guests where id = p_guest for update;
  if v_pass is null then
    return 0;
  end if;
  select coalesce(sum(credits), 0) into v_net from public.pass_redemptions where private_guest_id = p_guest and pass_id = v_pass;
  if v_net <= 0 then
    return 0;
  end if;
  update public.class_passes
     set credits_left = least(credits_total, credits_left + v_net),
         expires_on = greatest(expires_on, p_today + 90)
   where id = v_pass;
  insert into public.pass_redemptions (pass_id, private_guest_id, credits, note) values (v_pass, p_guest, -v_net, 'returned from a share');
  return v_net;
end;
$$;
revoke all on function public.return_pass_share(uuid, date) from public, anon, authenticated;

-- A share fully covered by a code: open -> paid with no payment, once.
create or replace function public.mark_share_paid_free(p_guest uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.private_guests
     set status = 'paid', paid_at = now(), hold_key = null, hold_until = null
   where id = p_guest
     and status = 'open'
     and share_cents - voucher_applied_cents - pass_applied_cents <= 0
     and (hold_key is null or hold_until is null or hold_until <= now());
  return found;
end;
$$;
revoke all on function public.mark_share_paid_free(uuid) from public, anon, authenticated;

-- Cancel some seats of a paid class booking, all in one step:
--  * only if the booking is still paid and has the seats it had when the
--    quote was made (so two cancels at once can't both apply),
--  * the new seats, guests and price are saved and the record appended,
--  * the cancelled seats go back to the class,
--  * pass credits for cancelled seats go back to the pass,
--  * voucher money that paid for the cancelled seats is taken off the
--    booking (it is given back as a new credit code by the website).
create or replace function public.partial_cancel_booking(
  p_booking uuid,
  p_expected_seats integer,
  p_new_guests jsonb,
  p_new_discount integer,
  p_new_total integer,
  p_cash_out integer,
  p_voucher_out integer,
  p_pass_back integer,
  p_today date,
  p_record jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.class_bookings%rowtype;
  v_new_seats integer;
begin
  select * into b from public.class_bookings where id = p_booking for update;
  if not found or b.status <> 'paid' or b.seats <> p_expected_seats then
    return false;
  end if;
  v_new_seats := jsonb_array_length(p_new_guests);
  if v_new_seats < 1 or v_new_seats >= b.seats
     or p_cash_out < 0 or p_cash_out > b.amount_paid_cents
     or p_voucher_out < 0 or p_voucher_out > b.voucher_applied_cents
     or p_pass_back < 0 or p_pass_back > b.pass_credits then
    return false;
  end if;
  update public.class_bookings
     set seats = v_new_seats,
         guests = p_new_guests,
         discount_cents = p_new_discount,
         total_cents = p_new_total,
         amount_paid_cents = amount_paid_cents - p_cash_out,
         voucher_applied_cents = voucher_applied_cents - p_voucher_out,
         pass_credits = pass_credits - p_pass_back,
         partial_cancellations = partial_cancellations || jsonb_build_array(p_record)
   where id = p_booking;
  update public.class_sessions set booked = greatest(0, booked - (b.seats - v_new_seats)) where id = b.session_id;
  if p_voucher_out > 0 and b.voucher_id is not null then
    insert into public.voucher_redemptions (voucher_id, class_booking_id, amount_cents, note)
    values (b.voucher_id, p_booking, -p_voucher_out, 'seats cancelled: given back as a credit code');
  end if;
  if p_pass_back > 0 and b.pass_id is not null then
    update public.class_passes
       set credits_left = least(credits_total, credits_left + p_pass_back),
           expires_on = greatest(expires_on, p_today + 90)
     where id = b.pass_id;
    insert into public.pass_redemptions (pass_id, booking_id, credits, note) values (b.pass_id, p_booking, -p_pass_back, 'seats cancelled');
  end if;
  return true;
end;
$$;
revoke all on function public.partial_cancel_booking(uuid, integer, jsonb, integer, integer, integer, integer, integer, date, jsonb) from public, anon, authenticated;
