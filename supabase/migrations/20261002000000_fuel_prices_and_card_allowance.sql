-- Fuel prices and the monthly fuel card allowance.
--
-- fuel_prices: petrol price per liter by date, shared by every user. Signed-in users
-- can read it; new prices are added from the SQL Editor, e.g.
--   insert into public.fuel_prices (price_date, price_per_liter) values ('2026-09-29', 395.10);
-- The app uses it to fill in the price when you add a fill-up and to forecast spending.

create table public.fuel_prices (
  fuel_type text not null default 'petrol',
  price_date date not null,
  price_per_liter numeric(8, 2) not null check (price_per_liter > 0),
  currency text not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  primary key (fuel_type, price_date)
);

alter table public.fuel_prices enable row level security;

create policy "Signed-in users read fuel prices" on public.fuel_prices
  for select to authenticated
  using (true);

revoke insert, update, delete on public.fuel_prices from anon, authenticated;

insert into public.fuel_prices (price_date, price_per_liter) values
  ('2026-05-23', 403.78),
  ('2026-05-30', 381.78),
  ('2026-06-06', 377.78),
  ('2026-06-13', 373.78),
  ('2026-06-20', 299.50),
  ('2026-06-27', 299.50),
  ('2026-07-04', 297.53),
  ('2026-07-11', 310.71),
  ('2026-07-18', 316.15),
  ('2026-07-21', 315.80),
  ('2026-07-22', 320.73),
  ('2026-07-23', 327.12),
  ('2026-07-24', 331.52),
  ('2026-07-25', 335.18),
  ('2026-07-26', 335.18),
  ('2026-07-28', 334.18),
  ('2026-07-29', 335.81),
  ('2026-07-30', 335.06),
  ('2026-07-31', 336.15),
  ('2026-08-01', 336.03),
  ('2026-08-04', 331.95),
  ('2026-08-05', 328.56),
  ('2026-08-06', 333.01),
  ('2026-08-07', 329.82),
  ('2026-08-08', 327.62),
  ('2026-08-11', 327.62),
  ('2026-08-12', 325.92),
  ('2026-08-13', 324.98),
  ('2026-08-14', 325.43),
  ('2026-08-18', 331.20),
  ('2026-08-19', 334.54),
  ('2026-08-20', 337.51),
  ('2026-08-21', 337.78),
  ('2026-08-22', 341.59),
  ('2026-08-25', 341.98),
  ('2026-08-26', 343.10),
  ('2026-08-28', 342.60),
  ('2026-08-29', 342.02),
  ('2026-09-01', 342.79),
  ('2026-09-02', 343.87),
  ('2026-09-03', 346.16),
  ('2026-09-04', 349.00),
  ('2026-09-05', 345.87),
  ('2026-09-08', 358.77),
  ('2026-09-09', 364.35),
  ('2026-09-10', 367.75),
  ('2026-09-11', 370.80),
  ('2026-09-12', 375.82),
  ('2026-09-15', 380.24),
  ('2026-09-16', 384.34),
  ('2026-09-17', 391.22),
  ('2026-09-18', 390.79),
  ('2026-09-19', 389.14),
  ('2026-09-22', 393.75),
  ('2026-09-23', 392.05),
  ('2026-09-24', 390.12),
  ('2026-09-25', 389.28),
  ('2026-09-26', 391.30)
on conflict (fuel_type, price_date) do update set price_per_liter = excluded.price_per_liter;

-- Liters the fuel card covers at the start of each month (0 = no fuel card).
alter table public.fuel_settings
  add column card_monthly_liters numeric(7, 2) not null default 0
  check (card_monthly_liters >= 0 and card_monthly_liters <= 10000);
