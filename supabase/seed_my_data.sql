-- Loads the existing Fuel Logbook history into ONE account. Everyone else who
-- signs in starts with an empty log.
--
-- 1. Run the migration in supabase/migrations first.
-- 2. Open the app and sign in with Google once, so the account exists.
-- 3. Paste this file into Supabase → SQL Editor and run it.
--
-- It stops without changing anything if the account doesn't exist yet or already
-- has fill-ups, so running it twice is safe.

do $$
declare
  account_email text := 'aliuppal@gmail.com';  -- the Google account that owns this data
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(account_email);
  if uid is null then
    raise exception 'No account for %. Sign in to the app with Google once, then run this again.', account_email;
  end if;

  if exists (select 1 from public.fuel_fillups where user_id = uid) then
    raise notice 'Account % already has fill-ups. Nothing was changed.', account_email;
    return;
  end if;

  insert into public.fuel_fillups (user_id, fill_date, odometer_km, liters, amount_paid, paid_by, partial_fill, note) values
    (uid, '2025-08-13', 53230, null,  null, 'self', false, ''),
    (uid, '2026-02-01', 64501, null,  null, 'self', false, ''),
    (uid, '2026-02-04', 65038, null,  null, 'self', false, ''),
    (uid, '2026-07-01', 76593, null,  null, 'self', false, ''),
    (uid, '2026-07-06', 77000, null,  null, 'self', false, ''),
    (uid, '2026-07-10', 77360, 27.39, null, 'self', false, ''),
    (uid, '2026-07-19', 77839, 27.44, null, 'self', false, ''),
    (uid, '2026-07-24', 78126, 22.32, null, 'self', false, 'Originally noted as 77126; corrected to 78126'),
    (uid, '2026-07-29', 78466, 25.47, null, 'self', false, ''),
    (uid, '2026-08-01', 78736, 24.08, null, 'self', false, ''),
    (uid, '2026-08-01', 78821,  6.80, null, 'self', false, ''),
    (uid, '2026-08-01', 78979, 10.00, null, 'self', false, ''),
    (uid, '2026-08-02', 79206, 18.02, null, 'self', false, ''),
    (uid, '2026-08-02', 79382, 10.31, null, 'self', false, ''),
    (uid, '2026-08-05', 79713, 24.49, null, 'self', false, 'Originally noted as 797135; corrected to 79713'),
    (uid, '2026-08-10', 79926, 19.65, null, 'self', false, ''),
    (uid, '2026-08-13', 80260, 26.59, null, 'self', false, ''),
    (uid, '2026-08-17', 80593, 28.04, null, 'self', false, ''),
    (uid, '2026-08-22', 80947, 25.30, null, 'self', false, ''),
    (uid, '2026-08-27', 81259, 25.00, null, 'self', false, ''),
    (uid, '2026-09-01', 81630, 30.21, null, 'self', false, ''),
    (uid, '2026-09-04', 81938, 26.08, null, 'self', false, ''),
    (uid, '2026-09-06', 82210, 21.75, null, 'self', false, ''),
    (uid, '2026-09-11', 82560, 21.96, null, 'self', false, ''),
    (uid, '2026-09-14', 82766, 23.75, null, 'self', false, ''),
    (uid, '2026-09-18', 83109, 27.44, null, 'self', false, ''),
    (uid, '2026-09-21', 83444, 28.63, null, 'self', false, ''),
    (uid, '2026-09-25', 83780, 30.07, null, 'self', false, '');

  insert into public.fuel_settings (user_id, currency, gallon_type, odometer_unit)
  values (uid, '$', 'US', 'km')
  on conflict (user_id) do nothing;

  raise notice 'Loaded 28 entries into %.', account_email;
end;
$$;
