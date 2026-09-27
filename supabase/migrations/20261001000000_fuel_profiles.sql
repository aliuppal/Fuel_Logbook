-- One profile per user, created automatically when someone first signs in with
-- Google. Row-level security lets each user read only their own profile, and they
-- can change only their name, photo and last-seen time; email and join date are
-- maintained by the database.

create table public.fuel_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '' check (char_length(full_name) <= 200),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 1000),
  provider text,                                   -- how they signed in, e.g. google
  created_at timestamptz not null default now(),   -- member since
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.fuel_profiles enable row level security;

create policy "Users read their own profile" on public.fuel_profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users update their own profile" on public.fuel_profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Rows are only created by the trigger below, and users may only edit these columns.
revoke insert, update, delete on public.fuel_profiles from anon, authenticated;
grant update (full_name, avatar_url, last_seen_at) on public.fuel_profiles to authenticated;

create trigger fuel_profiles_touch before update on public.fuel_profiles
  for each row execute function public.fuel_touch_updated_at();

-- Create the profile when a new account is made (first Google sign-in).
create or replace function public.fuel_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.fuel_profiles (id, email, full_name, avatar_url, provider)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    new.raw_app_meta_data ->> 'provider'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Keep the stored email in step if the account's email changes.
create or replace function public.fuel_sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.fuel_profiles set email = new.email where id = new.id;
  return new;
end;
$$;

revoke execute on function public.fuel_handle_new_user() from public, anon, authenticated;
revoke execute on function public.fuel_sync_user_email() from public, anon, authenticated;

create trigger fuel_on_auth_user_created
  after insert on auth.users
  for each row execute function public.fuel_handle_new_user();

create trigger fuel_on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.fuel_sync_user_email();

-- Profiles for anyone who signed up before this migration.
insert into public.fuel_profiles (id, email, full_name, avatar_url, provider, created_at)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''),
  coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'),
  u.raw_app_meta_data ->> 'provider',
  u.created_at
from auth.users u
on conflict (id) do nothing;
