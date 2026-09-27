-- Maintenance reminders. Each user keeps their own service rules ("oil change every
-- 5,000 km or 6 months") and a history of services done. The app works out when the
-- next service is due from the rule's last service and the latest odometer reading.
-- Row-level security keeps every user's rules and history private.

create table public.fuel_service_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  every_km integer check (every_km is null or every_km > 0),               -- distance interval
  every_months smallint check (every_months is null or every_months between 1 and 120), -- time interval
  last_done_km integer not null check (last_done_km >= 0),                 -- odometer at last service
  last_done_date date not null,
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (every_km is not null or every_months is not null)
);

create table public.fuel_service_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rule_id uuid references public.fuel_service_rules (id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),           -- kept if the rule is deleted
  service_date date not null,
  odometer_km integer not null check (odometer_km >= 0),
  cost numeric(12, 2) check (cost is null or cost >= 0),
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);

create index fuel_service_rules_user_idx on public.fuel_service_rules (user_id);
create index fuel_service_log_user_date_idx on public.fuel_service_log (user_id, service_date desc);

alter table public.fuel_service_rules enable row level security;
alter table public.fuel_service_log enable row level security;

create policy "Users manage their own service rules" on public.fuel_service_rules
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage their own service history" on public.fuel_service_log
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create trigger fuel_service_rules_touch before update on public.fuel_service_rules
  for each row execute function public.fuel_touch_updated_at();
