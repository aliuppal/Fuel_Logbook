-- One-time update for the owner's account, run after seed_my_data.sql and the
-- 20261002000000_fuel_prices_and_card_allowance migration:
--
-- 1. Sets the fuel card allowance to 100 liters a month.
-- 2. Marks who paid each fill-up: in each month, fill-ups are charged to the fuel card
--    until its 100 liters are used up, the rest are "paid by me". A fill-up that crosses
--    the limit goes to the card if at least half of it fits in what's left.
-- 3. Fills in "total paid" for fill-ups without a price, using the fuel price on that day
--    (the latest price on or before the fill-up date).
--
-- Safe to run again: it only fills in missing prices and recalculates who paid.

do $$
declare
  account_email text := 'aliuppal@gmail.com';  -- the Google account that owns this data
  allowance numeric := 100;                    -- liters per month on the fuel card
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(account_email);
  if uid is null then
    raise exception 'No account for %. Sign in to the app with Google once, then run this again.', account_email;
  end if;

  insert into public.fuel_settings (user_id, currency, card_monthly_liters)
  values (uid, 'PKR', allowance)
  on conflict (user_id) do update set card_monthly_liters = excluded.card_monthly_liters;

  with ordered as (
    select id, liters,
      coalesce(sum(liters) over (
        partition by date_trunc('month', fill_date)
        order by odometer_km
        rows between unbounded preceding and 1 preceding), 0) as used_before
    from public.fuel_fillups
    where user_id = uid and liters is not null
  )
  update public.fuel_fillups f
  set paid_by = case when allowance - o.used_before >= o.liters / 2 then 'card' else 'self' end
  from ordered o
  where f.id = o.id;

  update public.fuel_fillups f
  set amount_paid = round(f.liters * (
    select p.price_per_liter from public.fuel_prices p
    where p.fuel_type = 'petrol' and p.price_date <= f.fill_date
    order by p.price_date desc
    limit 1
  ), 2)
  where f.user_id = uid and f.liters is not null and f.amount_paid is null
    and exists (select 1 from public.fuel_prices p where p.fuel_type = 'petrol' and p.price_date <= f.fill_date);

  raise notice 'Updated fuel card and prices for %.', account_email;
end;
$$;
