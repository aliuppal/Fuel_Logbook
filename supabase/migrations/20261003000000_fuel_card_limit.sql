-- Monthly fuel card limit, set per user in Settings. It can be a number of liters
-- (card_monthly_liters, added earlier) or an amount of money (card_monthly_amount),
-- chosen by card_limit_type. The limit starts over on the 1st of every month; the
-- app works out what's used from the fill-ups marked "fuel card" in that month.
-- A limit of 0 means no fuel card, and the app then hides the fuel card figures.

alter table public.fuel_settings
  add column card_limit_type text not null default 'liters' check (card_limit_type in ('liters', 'amount')),
  add column card_monthly_amount numeric(12, 2) not null default 0 check (card_monthly_amount >= 0);
