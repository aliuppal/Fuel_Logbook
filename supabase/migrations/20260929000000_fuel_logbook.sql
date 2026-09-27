-- Fuel Logbook schema. Every row belongs to the signed-in user (auth.uid()), and
-- row-level security makes sure nobody can read or change another user's rows.
-- Tables are prefixed "fuel_" so they are easy to tell apart in the Supabase dashboard.

-- One row per fill-up or odometer reading. Distances are stored in kilometers and
-- fuel in liters; the app converts to miles and gallons for display.
create table public.fuel_fillups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fill_date date not null,
  odometer_km integer not null check (odometer_km >= 0),
  liters numeric(8, 3) check (liters is null or liters > 0),          -- null = odometer reading only
  amount_paid numeric(10, 2) check (amount_paid is null or amount_paid >= 0),
  paid_by text not null default 'self' check (paid_by in ('card', 'self')), -- card = fuel card, self = paid by me
  partial_fill boolean not null default false,                        -- tank not filled to full
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fuel_fillups_user_odometer_idx on public.fuel_fillups (user_id, odometer_km);

create table public.fuel_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  currency text not null default '$' check (char_length(currency) <= 4),
  gallon_type text not null default 'US' check (gallon_type in ('US', 'UK')),
  odometer_unit text not null default 'km' check (odometer_unit in ('km', 'mi')),
  updated_at timestamptz not null default now()
);

alter table public.fuel_fillups enable row level security;
alter table public.fuel_settings enable row level security;

create policy "Users manage their own fill-ups" on public.fuel_fillups
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage their own fuel settings" on public.fuel_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Keep updated_at current on every change.
create or replace function public.fuel_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger fuel_fillups_touch before update on public.fuel_fillups
  for each row execute function public.fuel_touch_updated_at();

create trigger fuel_settings_touch before update on public.fuel_settings
  for each row execute function public.fuel_touch_updated_at();
