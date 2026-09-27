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

const ruleFromRow = (r) => ({
  id: r.id,
  name: r.name,
  everyKm: r.every_km,
  everyMonths: r.every_months,
  lastKm: r.last_done_km,
  lastDate: r.last_done_date,
  note: r.note,
});

const LOG_COLUMNS = "id, rule_id, name, service_date, odometer_km, cost, note";
const logFromRow = (r) => ({ id: r.id, ruleId: r.rule_id, name: r.name, date: r.service_date, odo: r.odometer_km, cost: num(r.cost), note: r.note });

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

  // select("*") so settings still load before the card allowance migration has run.
  async getSettings() {
    const row = check(await this.supabase.from("fuel_settings").select("*").maybeSingle());
    if (!row) return null;
    return {
      currency: row.currency,
      gallon: row.gallon_type,
      odoUnit: row.odometer_unit,
      ...(row.card_monthly_liters != null ? { cardLiters: Number(row.card_monthly_liters) } : {}),
      ...(row.card_monthly_amount != null ? { cardAmount: Number(row.card_monthly_amount) } : {}),
      ...(row.card_limit_type ? { cardType: row.card_limit_type } : {}),
    };
  }

  async saveSettings(s) {
    const row = {
      user_id: this.user.id,
      currency: s.currency,
      gallon_type: s.gallon,
      odometer_unit: s.odoUnit,
      card_monthly_liters: s.cardLiters ?? 0,
      card_monthly_amount: s.cardAmount ?? 0,
      card_limit_type: s.cardType === "amount" ? "amount" : "liters",
    };
    // Columns from later migrations may not exist yet: drop any the database
    // says are missing and save the rest.
    for (let tries = 0; tries < 4; tries++) {
      const res = await this.supabase.from("fuel_settings").upsert(row);
      const missing = res.error && /'?(card_[a-z_]+)'? column|column "?(card_[a-z_]+)/.exec(res.error.message || "");
      const col = missing && (missing[1] || missing[2]);
      if (col && col in row) { delete row[col]; continue; }
      check(res);
      return;
    }
  }

  /* ---------- maintenance ---------- */
  // Resolve null when the maintenance tables haven't been created yet.
  async listServiceRules() {
    const res = await this.supabase
      .from("fuel_service_rules")
      .select("id, name, every_km, every_months, last_done_km, last_done_date, note")
      .order("created_at");
    if (res.error) return null;
    return res.data.map(ruleFromRow);
  }

  async listServiceLog() {
    const res = await this.supabase
      .from("fuel_service_log")
      .select(LOG_COLUMNS)
      .order("service_date", { ascending: false })
      .limit(200);
    if (res.error) return null;
    return res.data.map(logFromRow);
  }

  async saveServiceRule(rule, id) {
    const row = {
      name: rule.name,
      every_km: rule.everyKm || null,
      every_months: rule.everyMonths || null,
      last_done_km: rule.lastKm,
      last_done_date: rule.lastDate,
      note: rule.note || "",
    };
    const q = id
      ? this.supabase.from("fuel_service_rules").update(row).eq("id", id)
      : this.supabase.from("fuel_service_rules").insert(row);
    return ruleFromRow(check(await q.select("id, name, every_km, every_months, last_done_km, last_done_date, note").single()));
  }

  async deleteServiceRule(id) {
    check(await this.supabase.from("fuel_service_rules").delete().eq("id", id));
  }

  // Records a service in the history and moves the rule's "last done" to it.
  // One entry in the service history (also what the calendar shows).
  async addServiceLog(rule, done) {
    return logFromRow(check(
      await this.supabase
        .from("fuel_service_log")
        .insert({ rule_id: rule.id, name: rule.name, service_date: done.date, odometer_km: done.odo, cost: done.cost ?? null, note: done.note || "" })
        .select(LOG_COLUMNS)
        .single(),
    ));
  }

  async updateServiceLog(id, fields) {
    const row = {};
    if ("odo" in fields) row.odometer_km = fields.odo;
    if ("cost" in fields) row.cost = fields.cost ?? null;
    if ("name" in fields) row.name = fields.name;
    return logFromRow(check(await this.supabase.from("fuel_service_log").update(row).eq("id", id).select(LOG_COLUMNS).single()));
  }

  // Records a service in the history and moves the rule's "last done" to it.
  async markServiceDone(rule, done) {
    const log = await this.addServiceLog(rule, done);
    const updated = await this.saveServiceRule({ ...rule, lastKm: done.odo, lastDate: done.date }, rule.id);
    return { rule: updated, log };
  }

  async deleteServiceLog(id) {
    check(await this.supabase.from("fuel_service_log").delete().eq("id", id));
  }

  // Petrol prices per liter by date, oldest first. Empty if the table doesn't exist yet.
  async listPrices() {
    const res = await this.supabase
      .from("fuel_prices")
      .select("price_date, price_per_liter, currency")
      .eq("fuel_type", "petrol")
      .order("price_date");
    if (res.error) return [];
    return res.data.map((r) => ({ date: r.price_date, price: Number(r.price_per_liter), currency: r.currency }));
  }
}

export async function openStore(user) {
  return new FuelStore(await getClient(), user);
}
