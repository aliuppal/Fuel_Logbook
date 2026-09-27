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

`supabase/migrations/20260929000000_fuel_logbook.sql` creates two tables:

| Table | What it holds |
|---|---|
| `fuel_fillups` | One row per fill-up or odometer reading: `fill_date`, `odometer_km`, `liters` (null = reading only), `amount_paid`, `paid_by` (`card` or `self`), `partial_fill`, `note` |
| `fuel_settings` | One row per user: `currency`, `gallon_type` (`US`/`UK`), `odometer_unit` (`km`/`mi`) |

Distances are stored in km and fuel in liters; the app converts for display.

## Setup

Fuel Logbook has its own Supabase project, Google sign-in client, GitHub repository and GitHub
Pages site; nothing is shared with other apps. Do the steps in this order.

### 1. GitHub repository

1. Create an **empty** repository at https://github.com/new named `Fuel_Logbook` (no README,
   license or .gitignore). It must be **public** for GitHub Pages on a free account.
2. Push this folder:
   ```sh
   git remote add origin https://github.com/aliuppal/Fuel_Logbook.git
   git push -u origin main
   ```
3. In the repository, *Settings → Pages → Build and deployment → Source*: choose
   **GitHub Actions**. `.github/workflows/pages.yml` then publishes the site on every push to
   `main`, at https://aliuppal.github.io/Fuel_Logbook/.

### 2. Supabase project

1. Create a project at https://supabase.com/dashboard (for example `fuel-logbook`).
2. *SQL Editor*: paste `supabase/migrations/20260929000000_fuel_logbook.sql` and run it.
3. *Project Settings → API*: copy the **Project URL** and the **anon / publishable** key into
   `js/config.js`. Never use the `service_role` key.
4. *Authentication → URL Configuration*:
   - *Site URL*: `https://aliuppal.github.io/Fuel_Logbook/`
   - *Redirect URLs*: `https://aliuppal.github.io/Fuel_Logbook/` and `http://localhost:8081/`

### 3. Google sign-in

1. At https://console.cloud.google.com create a new project (for example `Fuel Logbook`).
2. *APIs & Services → OAuth consent screen* (Google Auth Platform → Branding): choose
   **External**, app name `Fuel Logbook`, your support email, and publish the app
   (*Audience → Publish app*) so any Google account can sign in, not only test users.
3. *Credentials → Create credentials → OAuth client ID → Web application*:
   - *Authorized JavaScript origins*: `https://aliuppal.github.io` and `http://localhost:8081`
   - *Authorized redirect URIs*: `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (Supabase shows this exact URL on its Google provider page).
4. In Supabase, *Authentication → Sign In / Providers → Google*: turn it on and paste the
   **Client ID** and **Client secret**.

### 4. Go live

1. Commit and push the updated `js/config.js`; the site redeploys by itself.
2. Open https://aliuppal.github.io/Fuel_Logbook/ (or run `npm start` for
   http://localhost:8081) and choose **Continue with Google**.
3. **Load your existing history (owner only):** after signing in once, paste
   `supabase/seed_my_data.sql` into Supabase's *SQL Editor* and run it. It adds the 28 existing
   entries to the account named at the top of the file and does nothing if that account already
   has fill-ups. Everyone else starts with an empty log.

## Project layout

```
index.html                 Markup: sign-in screen, app, add/edit sheet
styles.css                 Styles (light and dark)
js/app.js                  UI, calculations and charts
js/cloud.js                Supabase client, Google sign-in, table access
js/config.js               Supabase URL and anon key
supabase/migrations/       Table definitions and row-level security
supabase/seed_my_data.sql  One-time import of the owner's existing data
.github/workflows/pages.yml Deploys the site to GitHub Pages on every push to main
```
