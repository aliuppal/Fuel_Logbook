// Supabase database and Google sign-in. The app works with plain entry objects
// ({id, date, odo, liters, paid, payer, partial, note}); this file maps them to
// the fuel_fillups / fuel_settings columns.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let clientPromise = null;

export function getClient() {
  clientPromise ??= import(SUPABASE_JS).then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }),
  );
  return clientPromise;
}

// Resolves once any OAuth redirect in the URL has been exchanged for a session.
export async function getUser() {
  const supabase = await getClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}

export async function signInWithGoogle() {
  const supabase = await getClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    // Come back to this exact page (works on localhost and on GitHub Pages' /Fuel_Logbook/ path).
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
  const supabase = await getClient();
  await supabase.auth.signOut();
}

export async function onAuthChange(callback) {
  const supabase = await getClient();
  supabase.auth.onAuthStateChange((event, session) => callback(event, session?.user ?? null));
}

const check = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const num = (v) => (v == null ? null : Number(v));

const fromRow = (r) => ({
  id: r.id,
  date: r.fill_date,
  odo: r.odometer_km,
  liters: num(r.liters),
  paid: num(r.amount_paid),
  payer: r.paid_by,
  partial: r.partial_fill,
  note: r.note,
});

const toRow = (e) => ({
  fill_date: e.date,
  odometer_km: e.odo,
  liters: e.liters ?? null,
  amount_paid: e.paid ?? null,
  paid_by: e.payer === "card" ? "card" : "self",
  partial_fill: !!e.partial,
  note: e.note || "",
});

const FILLUP_COLUMNS = "id, fill_date, odometer_km, liters, amount_paid, paid_by, partial_fill, note";

export class FuelStore {
  constructor(supabase, user) {
    this.supabase = supabase;
    this.user = user;
  }

  async listEntries() {
    const rows = check(await this.supabase.from("fuel_fillups").select(FILLUP_COLUMNS).order("odometer_km"));
    return rows.map(fromRow);
  }

  // Pass an id to re-create a deleted entry (undo); otherwise the database makes one.
  async addEntry(entry, id) {
    const row = { ...toRow(entry), ...(id ? { id } : {}) };
    return fromRow(check(await this.supabase.from("fuel_fillups").insert(row).select(FILLUP_COLUMNS).single()));
  }

  async updateEntry(id, entry) {
    return fromRow(check(await this.supabase.from("fuel_fillups").update(toRow(entry)).eq("id", id).select(FILLUP_COLUMNS).single()));
  }

  async setPayer(id, payer) {
    check(await this.supabase.from("fuel_fillups").update({ paid_by: payer === "card" ? "card" : "self" }).eq("id", id));
  }

  async deleteEntry(id) {
    check(await this.supabase.from("fuel_fillups").delete().eq("id", id));
  }

  // Refreshes name, photo and last-seen time on sign-in and returns the profile
  // (the database creates it on first sign-in). Resolves null if it isn't there.
  async touchProfile() {
    const m = this.user.user_metadata || {};
    const row = check(
      await this.supabase
        .from("fuel_profiles")
        .update({
          full_name: m.full_name || m.name || "",
          avatar_url: m.avatar_url || m.picture || null,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", this.user.id)
        .select("email, full_name, avatar_url, created_at")
        .maybeSingle(),
    );
    return row && { email: row.email, name: row.full_name, avatar: row.avatar_url, since: row.created_at };
  }

  async getSettings() {
    const row = check(await this.supabase.from("fuel_settings").select("currency, gallon_type, odometer_unit").maybeSingle());
    return row ? { currency: row.currency, gallon: row.gallon_type, odoUnit: row.odometer_unit } : null;
  }

  async saveSettings(s) {
    check(
      await this.supabase.from("fuel_settings").upsert({
        user_id: this.user.id,
        currency: s.currency,
        gallon_type: s.gallon,
        odometer_unit: s.odoUnit,
      }),
    );
  }
}

export async function openStore(user) {
  return new FuelStore(await getClient(), user);
}
