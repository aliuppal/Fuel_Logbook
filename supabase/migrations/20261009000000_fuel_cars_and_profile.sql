-- Multiple cars per user, and contact details on the profile.
--
-- fuel_cars: each user's cars (market, make, model, year, engine, plate) with the
-- car's typical fuel average in km/L. Fill-ups, service reminders and service history
-- belong to a car through car_id; deleting a car deletes its fill-ups and services.
-- Everyone who already has data gets a first car ("My car") holding all of it.

create table public.fuel_cars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nickname text not null default '' check (char_length(nickname) <= 60),
  market text not null default 'PK' check (market in ('PK', 'US', 'other')),
  make text not null default '' check (char_length(make) <= 60),
  model text not null default '' check (char_length(model) <= 60),
  year smallint check (year is null or year between 1950 and 2100),
  engine text not null default '' check (char_length(engine) <= 60),
  rated_kmpl numeric(5, 2) check (rated_kmpl is null or (rated_kmpl > 0 and rated_kmpl < 100)),
  plate text not null default '' check (char_length(plate) <= 20),
  vin text not null default '' check (char_length(vin) <= 17),           -- vehicle identification number
  vin_data jsonb,                                                          -- details decoded from the VIN
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(nickname) > 0 or char_length(make) > 0)
);

create index fuel_cars_user_idx on public.fuel_cars (user_id, created_at);

alter table public.fuel_cars enable row level security;

create policy "Users manage their own cars" on public.fuel_cars
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create trigger fuel_cars_touch before update on public.fuel_cars
  for each row execute function public.fuel_touch_updated_at();

alter table public.fuel_fillups add column car_id uuid references public.fuel_cars (id) on delete cascade;
alter table public.fuel_service_rules add column car_id uuid references public.fuel_cars (id) on delete cascade;
alter table public.fuel_service_log add column car_id uuid references public.fuel_cars (id) on delete cascade;

create index fuel_fillups_car_idx on public.fuel_fillups (car_id);
create index fuel_service_rules_car_idx on public.fuel_service_rules (car_id);
create index fuel_service_log_car_idx on public.fuel_service_log (car_id);

-- Put everyone's existing fill-ups and services on a first car.
do $$
declare
  u record;
  cid uuid;
begin
  for u in
    select user_id from public.fuel_fillups
    union select user_id from public.fuel_service_rules
    union select user_id from public.fuel_service_log
  loop
    insert into public.fuel_cars (user_id, nickname) values (u.user_id, 'My car') returning id into cid;
    update public.fuel_fillups set car_id = cid where user_id = u.user_id and car_id is null;
    update public.fuel_service_rules set car_id = cid where user_id = u.user_id and car_id is null;
    update public.fuel_service_log set car_id = cid where user_id = u.user_id and car_id is null;
  end loop;
end;
$$;

-- Contact details and region on the profile, editable by the user. The region
-- (a country code such as PK, US, GB) sets the default units and currency.
alter table public.fuel_profiles
  add column phone text check (phone is null or char_length(phone) <= 30),
  add column address text check (address is null or char_length(address) <= 300),
  add column city text check (city is null or char_length(city) <= 100),
  add column region text check (region is null or region ~ '^[A-Z]{2}$');

grant update (full_name, avatar_url, last_seen_at, phone, address, city, region) on public.fuel_profiles to authenticated;
