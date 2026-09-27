-- Store the currency as an ISO 4217 code (PKR, USD, EUR, …) instead of a symbol,
-- so the app can format amounts correctly (Rs 5,000.00, $45.00, €40,00).

-- Convert symbols saved before this change.
update public.fuel_settings
set currency = case
  when currency ~ '^[A-Z]{3}$' then currency
  when currency in ('Rs', 'Rs.', '₨', 'PKR') then 'PKR'
  when currency = '€' then 'EUR'
  when currency = '£' then 'GBP'
  when currency = '₹' then 'INR'
  else 'USD'
end;

alter table public.fuel_settings drop constraint if exists fuel_settings_currency_check;
alter table public.fuel_settings
  alter column currency set default 'PKR',
  add constraint fuel_settings_currency_check check (currency ~ '^[A-Z]{3}$');
