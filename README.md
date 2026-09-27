# Fuel Logbook

A web app for logging car fill-ups and tracking fuel average and spending. People sign in with
Google, and each account's log is saved in Supabase and kept private to that account. New accounts
start with an empty log.

## Features

- **Fuel average** in km/L, km/gal, mi/L or mpg: current (last full tank), this month and overall,
  with a gauge and a chart of every fill-up.
- **Unit switches:** kilometers or miles, liters or gallons (US or UK gallon in Settings).
- **Fill-ups:** date, odometer, fuel, total paid or price per liter/gallon, a note, and a
  "didn't fill to full" option. Partial fills roll into the next full tank.
- **Who paid:** mark each fill-up as **Fuel card** or **Me**; tap the tag in the log to switch it.
- **Spending:** this week, this month and overall, split by fuel card and me. Reports show
  spending by month and a weekly or monthly breakdown.
- **Google sign-in** through Supabase Auth. Row-level security means nobody can read or change
  another user's rows.

## Database

`supabase/migrations/` creates four tables:

| Table | What it holds |
|---|---|
| `fuel_fillups` | One row per fill-up or odometer reading: `fill_date`, `odometer_km`, `liters` (null = reading only), `amount_paid`, `paid_by` (`card` or `self`), `partial_fill`, `note` |
| `fuel_prices` | Petrol price per liter by date (`price_date`, `price_per_liter`, `currency`), shared by all users and readable when signed in. Add new prices from the SQL Editor |
| `fuel_profiles` | One row per user, created automatically on first Google sign-in: `email`, `full_name`, `avatar_url`, `provider`, `created_at` (member since), `last_seen_at`. Users can only read their own profile and edit their name, photo and last-seen time |
| `fuel_settings` | One row per user: `currency` (ISO code such as `PKR`, `USD`), `gallon_type` (`US`/`UK`), `odometer_unit` (`km`/`mi`), `card_limit_type` (`liters` or `amount`), `card_monthly_liters` / `card_monthly_amount` (monthly fuel card limit; 0 = no fuel card). The limit starts over on the 1st of each month |

Distances are stored in km and fuel in liters; the app converts for display.

## Where it runs

Fuel Logbook has its own GitHub repository, Supabase project and Google sign-in client; nothing is
shared with other apps. Every push to `main` redeploys both sites:

| Site | URL | How it deploys |
|---|---|---|
| Vercel | https://fuel-logbook.vercel.app/ | Vercel project `fuel-logbook`, connected to the GitHub repo |
| GitHub Pages | https://aliuppal.github.io/Fuel_Logbook/ | *Settings → Pages*: deploy from branch `main`, folder `/` |
| Local | http://localhost:8081/ | `npm start` |

Code: https://github.com/aliuppal/Fuel_Logbook

## Setup

### 1. Supabase

1. *SQL Editor*: run each file in `supabase/migrations/` in order (`20260929000000_fuel_logbook.sql`, then `20260930000000_fuel_currency_codes.sql`, then `20261001000000_fuel_profiles.sql`, then `20261002000000_fuel_prices_and_card_allowance.sql`, then `20261003000000_fuel_card_limit.sql`).
2. `js/config.js` holds the project's **Project URL** and **anon / publishable** key
   (*Project Settings → API*). Never use the `service_role` key.
3. *Authentication → URL Configuration*:
   - *Site URL*: `https://fuel-logbook.vercel.app/`
   - *Redirect URLs*: `https://fuel-logbook.vercel.app/`, `https://aliuppal.github.io/Fuel_Logbook/`
     and `http://localhost:8081/`

### 2. Google sign-in

1. At https://console.cloud.google.com create a new project (for example `Fuel Logbook`).
2. *Google Auth Platform → Branding*: app name `Fuel Logbook`, your support email. Under
   *Audience* choose **External** and **Publish app**, so any Google account can sign in, not only
   test users.
3. *Clients → Create client → Web application*:
   - *Authorized JavaScript origins*: `https://fuel-logbook.vercel.app`, `https://aliuppal.github.io`
     and `http://localhost:8081`
   - *Authorized redirect URIs*: `https://nmithewveywisilucruv.supabase.co/auth/v1/callback`
4. In Supabase, *Authentication → Sign In / Providers → Google*: turn it on and paste the
   **Client ID** and **Client secret**.

### 3. Load your existing history (owner only)

Open the app, choose **Continue with Google** once, then paste `supabase/seed_my_data.sql` into
Supabase's *SQL Editor* and run it. It adds the 28 existing entries to the account named at the
top of the file and does nothing if that account already has fill-ups. Everyone else starts with
an empty log.

Then run `supabase/apply_card_and_prices.sql`: it sets the 100-liter monthly fuel card allowance,
marks each past fill-up as fuel card or me (card first each month until 100 L), and fills in what
each one cost from the fuel price on that day.

## Project layout

```
index.html                 Markup: sign-in screen, app, add/edit sheet
styles.css                 Styles (light and dark)
js/app.js                  UI, calculations and charts
js/cloud.js                Supabase client, Google sign-in, table access
js/config.js               Supabase URL and anon key
supabase/migrations/       Table definitions and row-level security
supabase/seed_my_data.sql  One-time import of the owner's existing data
manifest.webmanifest       App name, colors and icons for installing on a phone
sw.js                      Service worker: offline support for the installed app
icons/                     App icons (SVG source and PNG sizes)
vercel.json                Serves sw.js uncached so updates reach installed apps
```

## Install on your phone

Fuel Logbook is an installable web app (PWA): it gets its own home-screen icon, opens full screen
without the browser bar, and shows your last loaded log when you're offline (changes need a
connection).

- **Android (Chrome):** open https://fuel-logbook.vercel.app → account menu → **Install app on
  this device**, or ⋮ menu → **Install app**. Long-press the icon for an **Add fill-up** shortcut.
- **iPhone (Safari):** open the site → **Share** → **Add to Home Screen**.
- **Desktop (Chrome/Edge):** the install icon in the address bar, or the account menu.

`manifest.webmanifest` holds the app name, colors and icons (`icons/`), and `sw.js` is the
service worker that caches the app for offline use. Bump `CACHE` in `sw.js` when you rename or
remove app files.
