-- Small gaps after phase 5:
--   * the automatic refund from a partial seat cancellation is saved onto its record
--   * a private class can lower its guest numbers after the deposit
--   * customers can ask for their cake not to be photographed or posted
-- Run after 20261112000000_phase5.sql.

-- Photo opt-out on cake orders --------------------------------------------------------
alter table public.orders
  add column photo_opt_out boolean not null default false;

-- Lowering private class guest numbers -------------------------------------------------
alter table public.private_requests
  add column guest_reductions jsonb not null default '[]'::jsonb;

-- Removed places are kept (their payments, refunds, vouchers and pass credits point at
-- them) but no longer count as guests.
alter table public.private_guests drop constraint if exists private_guests_status_check;
alter table public.private_guests
  add constraint private_guests_status_check check (status in ('open','paid','removed'));

-- Guests joining only ever take an empty place that is still open.
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
   where request_id = p_request_id and name = '' and status = 'open'
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

-- All or nothing. False if the request or any place changed since the quote:
-- the guest numbers, a place being paid or held for checkout, or a code on a
-- place that would be worth more than its new share.
create or replace function public.reduce_private_guests(
  p_request uuid,
  p_expected_guests integer,
  p_new_guests integer,
  p_new_estimate integer,
  p_remove_open uuid[],
  p_remove_paid uuid[],
  p_share_updates jsonb,
  p_free uuid[],
  p_cash_out integer,
  p_record jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.private_requests%rowtype;
  v_update_ids uuid[];
  v_count integer;
  u jsonb;
begin
  select * into r from public.private_requests where id = p_request for update;
  if not found or r.status <> 'paid' or r.guests <> p_expected_guests then
    return false;
  end if;
  if p_new_guests < 1 or p_new_guests >= r.guests or p_new_estimate < 0 then
    return false;
  end if;
  if p_cash_out < 0 or p_cash_out > r.amount_paid_cents then
    return false;
  end if;

  select coalesce(array_agg((x->>'id')::uuid), '{}') into v_update_ids from jsonb_array_elements(coalesce(p_share_updates, '[]'::jsonb)) x;
  perform 1 from public.private_guests
   where request_id = p_request
     and id = any(coalesce(p_remove_open, '{}') || coalesce(p_remove_paid, '{}') || v_update_ids)
   order by id for update;

  select count(*) into v_count from public.private_guests
   where request_id = p_request and id = any(coalesce(p_remove_open, '{}'))
     and status = 'open' and (hold_key is null or hold_until is null or hold_until <= now());
  if v_count <> coalesce(array_length(p_remove_open, 1), 0) then
    return false;
  end if;
  select count(*) into v_count from public.private_guests
   where request_id = p_request and id = any(coalesce(p_remove_paid, '{}')) and status = 'paid';
  if v_count <> coalesce(array_length(p_remove_paid, 1), 0) then
    return false;
  end if;
  select count(*) into v_count
    from public.private_guests g
    join jsonb_array_elements(coalesce(p_share_updates, '[]'::jsonb)) x on (x->>'id')::uuid = g.id
   where g.request_id = p_request
     and g.status = 'open'
     and (g.hold_key is null or g.hold_until is null or g.hold_until <= now())
     and (x->>'share_cents')::integer >= g.voucher_applied_cents + g.pass_applied_cents;
  if v_count <> coalesce(array_length(v_update_ids, 1), 0) then
    return false;
  end if;
  if exists (select 1 from unnest(coalesce(p_free, '{}')) f where not (f = any(v_update_ids))) then
    return false;
  end if;

  update public.private_guests set status = 'removed'
   where request_id = p_request and id = any(coalesce(p_remove_open, '{}') || coalesce(p_remove_paid, '{}'));
  for u in select * from jsonb_array_elements(coalesce(p_share_updates, '[]'::jsonb)) loop
    update public.private_guests set share_cents = (u->>'share_cents')::integer
     where id = (u->>'id')::uuid and request_id = p_request;
  end loop;
  update public.private_guests
     set status = 'paid', paid_at = now(), hold_key = null, hold_until = null
   where request_id = p_request and id = any(coalesce(p_free, '{}'))
     and share_cents - voucher_applied_cents - pass_applied_cents = 0;

  update public.private_requests
     set guests = p_new_guests,
         estimate_cents = p_new_estimate,
         amount_paid_cents = amount_paid_cents - p_cash_out,
         guest_reductions = guest_reductions || jsonb_build_array(p_record)
   where id = p_request;
  return true;
end;
$$;
revoke all on function public.reduce_private_guests(uuid, integer, integer, integer, uuid[], uuid[], jsonb, uuid[], integer, jsonb) from public, anon, authenticated;

-- Save an automatic refund onto the matching record (by its "at" time).
create or replace function public.record_reduction_refund(p_request uuid, p_at text, p_refunded integer, p_refund_ids jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.private_requests
     set guest_reductions = (
       select coalesce(jsonb_agg(
         case when e->>'at' = p_at
              then e || jsonb_build_object('autoRefundedCents', p_refunded, 'refundIds', p_refund_ids)
              else e end
         order by ord), '[]'::jsonb)
       from jsonb_array_elements(guest_reductions) with ordinality as t(e, ord))
   where id = p_request;
$$;
revoke all on function public.record_reduction_refund(uuid, text, integer, jsonb) from public, anon, authenticated;

create or replace function public.record_partial_cancel_refund(p_booking uuid, p_at text, p_refunded integer, p_refund_ids jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.class_bookings
     set partial_cancellations = (
       select coalesce(jsonb_agg(
         case when e->>'at' = p_at
              then e || jsonb_build_object('autoRefundedCents', p_refunded, 'refundIds', p_refund_ids)
              else e end
         order by ord), '[]'::jsonb)
       from jsonb_array_elements(partial_cancellations) with ordinality as t(e, ord))
   where id = p_booking;
$$;
revoke all on function public.record_partial_cancel_refund(uuid, text, integer, jsonb) from public, anon, authenticated;
