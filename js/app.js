import { cloudConfigured, getUser, signInWithGoogle, signOut, onAuthChange, openStore } from "./cloud.js";

const KM_PER_MI = 1.609344, GAL = {US:3.785411784, UK:4.54609};
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
let entries = [], settings = {currency:"PKR", gallon:"US", odoUnit:"km", cardLiters:0, cardAmount:0, cardType:"liters"};
let ui = {dist:"km", vol:"L", per:"month", f:"all", tab:"overview"};
try{ Object.assign(ui, JSON.parse(localStorage.getItem("fuel-ui2") || "{}")); }catch(e){}
function saveUi(){ try{ localStorage.setItem("fuel-ui2", JSON.stringify(ui)); }catch(e){} }

let prices = [], store = null, loaded = false, editingId = null, payer = "self", lastPriceEdit = "paid";
const $ = id => document.getElementById(id);

/* ---------- units & format ---------- */
const dOut = km => ui.dist === "km" ? km : km / KM_PER_MI;
const vOut = L => ui.vol === "L" ? L : L / GAL[settings.gallon];
const vIn = v => ui.vol === "L" ? v : v * GAL[settings.gallon];
const dU = () => ui.dist === "km" ? "km" : "mi";
const vU = () => ui.vol === "L" ? "L" : "gal";
const econ = (km, L) => dOut(km) / vOut(L);
const econUnit = () => ui.dist === "mi" && ui.vol === "gal" ? "mpg" : dU() + "/" + vU();
const fmt = (n, d=1) => n == null || !isFinite(n) ? "–" : n.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
/* ---------- currency ---------- */
// Shown first in Settings; every other ISO currency the browser knows follows.
const COMMON_CURRENCIES = ["PKR","USD","EUR","GBP","AED","SAR","QAR","OMR","KWD","BHD","INR","CAD","AUD","CNY","JPY"];
const LEGACY_SYMBOLS = {"$":"USD", "Rs":"PKR", "Rs.":"PKR", "₨":"PKR", "€":"EUR", "£":"GBP", "₹":"INR"};
// Older saves stored a symbol; turn anything that isn't an ISO code into one.
const DEFAULT_CURRENCY = "PKR";
const QUICK_CURRENCIES = ["PKR","USD","EUR","GBP","AED","SAR"];
const curCode = c => /^[A-Z]{3}$/.test(c || "") ? c : LEGACY_SYMBOLS[(c || "").trim()] || DEFAULT_CURRENCY;
const moneyFormats = {};
function moneyFormat(code, digits){
  const key = code + digits;
  if (!moneyFormats[key]){
    const opts = {style:"currency", currency:code, minimumFractionDigits:digits, maximumFractionDigits:digits};
    try{ moneyFormats[key] = new Intl.NumberFormat(undefined, {...opts, currencyDisplay:"narrowSymbol"}); }
    catch(e){ moneyFormats[key] = new Intl.NumberFormat(undefined, opts); }
  }
  return moneyFormats[key];
}
const money = (n, digits = 2) => n == null || !isFinite(n) ? "–" : moneyFormat(curCode(settings.currency), digits).format(n);
const curSymbol = code => moneyFormat(code, 0).formatToParts(0).find(p => p.type === "currency")?.value || code;
function curName(code){
  try{ return new Intl.DisplayNames(undefined, {type:"currency"}).of(code) || code; }catch(e){ return code; }
}
function currencyLabel(code){
  const sym = curSymbol(code);
  return code + " · " + curName(code) + (sym !== code ? " (" + sym + ")" : "");
}
// Fills the Settings menu, the add/edit form menu and the quick-pick buttons.
function fillCurrencySelect(){
  let all = [];
  try{ all = Intl.supportedValuesOf("currency"); }catch(e){}
  const rest = all.filter(c => !COMMON_CURRENCIES.includes(c));
  const opt = c => `<option value="${c}">${esc(currencyLabel(c))}</option>`;
  const html = `<optgroup label="Common">${COMMON_CURRENCIES.map(opt).join("")}</optgroup>` +
    (rest.length ? `<optgroup label="All currencies">${rest.map(opt).join("")}</optgroup>` : "");
  $("sCur").innerHTML = html;
  $("fCur").innerHTML = html;
  $("curQuick").innerHTML = QUICK_CURRENCIES.map(c =>
    `<button type="button" class="fchip" data-cur="${c}" title="${esc(curName(c))}">${esc(curSymbol(c) !== c ? curSymbol(c) + " " + c : c)}</button>`).join("");
}
function setCurrency(code){
  if (curCode(settings.currency) === code) return;
  settings.currency = code; render(); saveSettings();
  toast("Currency set to " + curName(code) + " (" + code + ")");
}
function renderCurrency(){
  const code = curCode(settings.currency), sym = curSymbol(code);
  $("sCur").value = code;
  $("curSym").textContent = sym;
  $("curName").textContent = curName(code);
  $("curCode").textContent = code + " · used for all amounts";
  document.querySelectorAll("[data-cur]").forEach(b => b.setAttribute("aria-pressed", b.dataset.cur === code));
  if (document.activeElement !== $("fCur")) $("fCur").value = code;
  $("fPaidLbl").textContent = "Total paid (" + sym + ")";
  $("fPpuLbl").textContent = "Price per " + vU() + " (" + sym + ")";
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);

/* ---------- dates ---------- */
const pd = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };
const iso = d => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
const monthKey = s => s.slice(0,7);
function weekKey(s){ const d = pd(s); d.setDate(d.getDate() - (d.getDay()+6)%7); return iso(d); }
const shortDate = s => { const d = pd(s); return d.getDate() + " " + MON[d.getMonth()]; };
const longDate = s => { const d = pd(s); return d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear(); };
function weekLabel(k){ const a = pd(k), b = pd(k); b.setDate(b.getDate()+6);
  return a.getMonth() === b.getMonth() ? a.getDate() + "–" + b.getDate() + " " + MON[a.getMonth()] + " " + a.getFullYear()
    : a.getDate() + " " + MON[a.getMonth()] + " – " + b.getDate() + " " + MON[b.getMonth()] + " " + b.getFullYear(); }
function monthLabel(k){ const [y,m] = k.split("-").map(Number); return MON[m-1] + " " + y; }
const todayIso = () => iso(new Date());

/* ---------- calculations ---------- */
function compute(){
  const list = entries.filter(e => e && e.date && isFinite(e.odo)).sort((a,b) => a.odo - b.odo || a.date.localeCompare(b.date));
  const segs = [], segById = {}, prevById = {};
  let anchor = null, pend = 0, prev = null;
  for (const e of list){
    if (prev) prevById[e.id] = prev;
    prev = e;
    if (!(e.liters > 0)) continue;
    if (e.partial){ if (anchor) pend += e.liters; continue; }
    if (anchor){
      const dist = e.odo - anchor.odo, lit = pend + e.liters;
      if (dist > 0 && dist < 3000){ const s = {id:e.id, date:e.date, dist, lit}; segs.push(s); segById[e.id] = s; }
    }
    anchor = e; pend = 0;
  }
  const overall = agg(segs);
  return {list, segs, segById, prevById, overall};
}
function agg(segs){ const dist = sum(segs, s => s.dist), lit = sum(segs, s => s.lit); return {dist, lit, e: lit > 0 ? econ(dist, lit) : null}; }
function rating(e, avg){ if (!avg || e == null) return ""; const r = e / avg; return r >= 1.05 ? "good" : r <= 0.95 ? "poor" : ""; }
const isCard = e => e.payer === "card";

/* ---------- render ---------- */
function render(){
  const C = compute(), {list, segs, overall} = C;
  document.querySelectorAll("[data-dist]").forEach(b => b.setAttribute("aria-pressed", b.dataset.dist === ui.dist));
  document.querySelectorAll("[data-vol]").forEach(b => b.setAttribute("aria-pressed", b.dataset.vol === ui.vol));
  document.querySelectorAll("[data-per]").forEach(b => b.setAttribute("aria-pressed", b.dataset.per === ui.per));
  document.querySelectorAll("[data-f]").forEach(b => b.setAttribute("aria-pressed", b.dataset.f === ui.f));
  document.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === ui.tab));
  document.querySelectorAll("[data-view]").forEach(v => v.hidden = v.dataset.view !== ui.tab);
  document.querySelectorAll(".eu").forEach(el => el.textContent = econUnit());
  renderCurrency();
  $("sGal").value = settings.gallon; $("sOdo").value = settings.odoUnit;
  // Fuel card figures only show for people who have a fuel card.
  document.body.classList.toggle("no-card", !hasLimit() && !entries.some(isCard));
  document.querySelectorAll("[data-ltype]").forEach(b => b.setAttribute("aria-pressed", b.dataset.ltype === limitType()));
  $("sLimitLbl").textContent = limitType() === "amount" ? "Amount each month (" + curSymbol(curCode(settings.currency)) + ")" : "Fuel each month (" + vU() + ")";
  if (document.activeElement !== $("sLimit")) $("sLimit").value = !hasLimit() ? "" : limitType() === "amount" ? settings.cardAmount : +vOut(settings.cardLiters).toFixed(1);
  $("sLimitClear").hidden = !hasLimit();

  const fills = list.filter(e => e.liters > 0);
  const unpriced = fills.filter(e => !(e.paid > 0));
  $("tabCount").hidden = !unpriced.length; $("tabCount").textContent = unpriced.length;
  if (!loaded) $("sub").textContent = "Loading…";
  else if (!list.length) $("sub").textContent = "No entries yet";
  else { const last = list[list.length-1]; $("sub").textContent = fmt(dOut(last.odo), 0) + " " + dU() + " · updated " + longDate(last.date); }

  $("todo").hidden = !loaded || !unpriced.length;
  $("todoText").innerHTML = `<strong>${unpriced.length} fill-up${unpriced.length>1?"s":""} ${unpriced.length>1?"have":"has"} no price.</strong> Add what you paid and mark fuel card or me to see your spending.`;

  if (ui.tab === "overview") renderOverview(C, fills);
  if (ui.tab === "log") renderLog(C);
  renderServiceBadges(C);
  if (ui.tab === "service") renderService(C);
  if (ui.tab === "reports"){ renderSpendChart(list); renderBreakdown(list, segs); }
}

function renderOverview(C, fills){
  const {list, segs, segById, overall} = C;
  // A brand-new account sees a welcome card instead of empty gauges.
  const fresh = loaded && !list.length;
  $("welcome").hidden = !fresh;
  document.querySelectorAll(".dash").forEach(el => el.hidden = fresh);
  if (fresh) return;
  renderLimit(C);
  const now = todayIso(), mk = monthKey(now), wk = weekKey(now);
  const cur = segs[segs.length-1];
  const curE = cur ? econ(cur.dist, cur.lit) : null;
  $("gCur").textContent = fmt(curE);
  renderGauge(segs, curE, overall.e);
  if (cur){
    $("gCurMeta").textContent = "Full tank on " + shortDate(cur.date) + " · " + fmt(dOut(cur.dist),0) + " " + dU() + " on " + fmt(vOut(cur.lit),2) + " " + vU();
    const pct = (curE / overall.e - 1) * 100;
    $("gDelta").hidden = !overall.e;
    $("gDelta").textContent = Math.abs(pct) < 0.5 ? "Same as your overall average" : (pct > 0 ? "▲ " : "▼ ") + fmt(Math.abs(pct), 0) + "% " + (pct > 0 ? "better" : "worse") + " than overall";
    $("gDelta").style.color = pct >= 0.5 ? "var(--good)" : pct <= -0.5 ? "var(--warn)" : "";
  } else { $("gCurMeta").textContent = "Needs two full fill-ups"; $("gDelta").hidden = true; }

  const ms = segs.filter(s => monthKey(s.date) === mk), ma = agg(ms);
  $("sMonLbl").textContent = "This month · " + MON[+mk.slice(5)-1];
  $("sMon").innerHTML = fmt(ma.e) + `<small>${econUnit()}</small>`;
  $("sMonS").textContent = ms.length ? ms.length + " tanks · " + fmt(dOut(ma.dist),0) + " " + dU() : "No full tanks yet this month";
  $("sAll").innerHTML = fmt(overall.e) + `<small>${econUnit()}</small>`;
  $("sAllS").textContent = segs.length ? segs.length + " tanks since " + longDate(segs[0].date) : "Needs two full fill-ups";
  const priced = segs.filter(s => { const e = list.find(x => x.id === s.id); return e && e.paid > 0; });
  const pDist = sum(priced, s => s.dist), pCost = sum(priced, s => list.find(x => x.id === s.id).paid);
  $("sCpdLbl").textContent = "Cost per " + dU();
  $("sCpd").textContent = pDist > 0 ? money(pCost / dOut(pDist)) : "–";
  $("sCpdS").textContent = pDist > 0 ? "from " + priced.length + " priced tanks" : "Add prices to see this";
  $("sDist").innerHTML = fmt(dOut(overall.dist), 0) + `<small>${dU()}</small>`;
  // Distance is counted from the first full tank, so "since" is that fill-up's date.
  const firstSeg = segs[0], startFill = firstSeg && list.find(e => e.odo === list.find(x => x.id === firstSeg.id).odo - firstSeg.dist);
  $("sDistS").textContent = fmt(vOut(overall.lit), 1) + " " + vU() + " of fuel" + (startFill ? " · since " + longDate(startFill.date) : "");

  const paid = list.filter(e => e.paid > 0);
  const spendFor = arr => ({card: sum(arr.filter(isCard), e => e.paid), self: sum(arr.filter(e => !isCard(e)), e => e.paid)});
  const blocks = [
    ["This week", weekLabel(wk), e => weekKey(e.date) === wk],
    ["This month", MONL[+mk.slice(5)-1] + " " + mk.slice(0,4), e => monthKey(e.date) === mk],
    ["Overall", fills.length ? "since " + longDate(fills[0].date) : "all time", () => true]
  ];
  $("spendgrid").innerHTML = blocks.map(([t, sub, f]) => {
    const s = spendFor(paid.filter(f)), tot = s.card + s.self, fl = fills.filter(f), vol = sum(fl, e => e.liters);
    return `<div class="sp">
      <span class="lbl">${t}</span>
      <span class="tot">${money(tot)}</span>
      <div class="stack" aria-hidden="true">${tot > 0 ? `<span style="width:${s.card/tot*100}%;background:var(--card)"></span><span style="width:${s.self/tot*100}%;background:var(--me)"></span>` : ""}</div>
      <div class="legend card-only"><span>Card <b style="color:var(--card)">${money(s.card)}</b></span><span>Me <b style="color:var(--me)">${money(s.self)}</b></span></div>
      <span class="muted" style="font-size:12.5px">${esc(sub)} · ${fl.length} fill-ups · ${fmt(vOut(vol),1)} ${vU()}</span>
    </div>`;
  }).join("");

  renderChart(segs, overall.e);
  renderCalendar(C);
  renderForecast(C);
  const recent = list.slice(-5).reverse();
  $("recent").innerHTML = recent.length ? recent.map(e => entryRow(e, C)).join("") : `<p class="empty">${loaded ? "No entries yet. Add your first fill-up." : "Loading…"}</p>`;
}

function arcPath(cx, cy, r, a0, a1){
  const p = a => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  const [x0,y0] = p(a0), [x1,y1] = p(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${Math.abs(a0-a1) > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function renderGauge(segs, cur, avg){
  const cx = 140, cy = 140, r = 108;
  const vals = segs.map(s => econ(s.dist, s.lit));
  let lo = vals.length ? Math.floor(Math.min(...vals)) : 0, hi = vals.length ? Math.ceil(Math.max(...vals)) : 1;
  if (hi <= lo) hi = lo + 1;
  const ang = v => Math.PI * (1 - Math.max(0, Math.min(1, (v - lo) / (hi - lo))));
  let g = `<path d="${arcPath(cx,cy,r,Math.PI,0)}" fill="none" style="stroke:color-mix(in srgb,var(--surface) 14%,transparent)" stroke-width="16" stroke-linecap="round"/>`;
  for (let i = 0; i <= 10; i++){ const a = Math.PI * i / 10, r1 = r - 16, r2 = r - (i % 5 ? 21 : 26);
    g += `<line x1="${cx + r1*Math.cos(a)}" y1="${cy - r1*Math.sin(a)}" x2="${cx + r2*Math.cos(a)}" y2="${cy - r2*Math.sin(a)}" style="stroke:color-mix(in srgb,var(--surface) 30%,transparent)" stroke-width="1.5"/>`; }
  if (cur != null) g += `<path d="${arcPath(cx,cy,r,Math.PI,Math.min(Math.PI - 0.001, ang(cur)))}" fill="none" style="stroke:var(--accent)" stroke-width="16" stroke-linecap="round"/>`;
  if (avg){ const a = ang(avg), r1 = r - 12, r2 = r + 12;
    g += `<line x1="${cx + r1*Math.cos(a)}" y1="${cy - r1*Math.sin(a)}" x2="${cx + r2*Math.cos(a)}" y2="${cy - r2*Math.sin(a)}" style="stroke:var(--surface)" stroke-width="3" stroke-linecap="round"/>`;
    const tx = cx + (r + 22) * Math.cos(a), ty = cy - (r + 22) * Math.sin(a);
    g += `<text x="${tx}" y="${Math.max(12, ty)}" text-anchor="${a > Math.PI*0.6 ? "end" : a < Math.PI*0.4 ? "start" : "middle"}">avg ${fmt(avg)}</text>`; }
  g += `<text x="${cx - r}" y="${cy + 16}" text-anchor="middle">${lo}</text><text x="${cx + r}" y="${cy + 16}" text-anchor="middle">${hi}</text>`;
  $("gauge").innerHTML = g;
}

function entryRow(e, C){
  const s = C.segById[e.id], prev = C.prevById[e.id], isFill = e.liters > 0;
  const d = pd(e.date);
  const ev = s ? econ(s.dist, s.lit) : null;
  const since = prev ? " · +" + fmt(dOut(e.odo - prev.odo), 0) + " " + dU() : "";
  const l2 = isFill ? fmt(vOut(e.liters), 2) + " " + vU() + (e.paid > 0 ? " · " + money(e.paid / vOut(e.liters)) + "/" + vU() : "") : "Odometer reading";
  const pay = !isFill ? '<span class="chip read">Reading</span>'
    : `${e.partial ? '<span class="chip part">Partial</span>' : ""}<button class="chip card-only ${isCard(e) ? "card" : "self"}" data-toggle="${esc(e.id)}" title="Switch who paid">${isCard(e) ? "Fuel card" : "Me"}</button>` +
      (e.paid > 0 ? `<button class="price" data-price="${esc(e.id)}">${money(e.paid)}</button>` : `<button class="price add" data-price="${esc(e.id)}">+ price</button>`);
  return `<div class="entry">
    <div class="dd"><b>${d.getDate()}</b><span>${MON[d.getMonth()]}</span></div>
    <div class="em"><div class="l1">${fmt(dOut(e.odo),0)} ${dU()}<span class="muted" style="font-weight:400">${since}</span></div><div class="l2">${l2}</div>${e.note ? `<div class="note">${esc(e.note)}</div>` : ""}</div>
    <div class="ec ${rating(ev, C.overall.e)}">${ev != null ? `<b>${fmt(ev)}</b><small>${econUnit()}</small>` : '<small>–</small>'}</div>
    <div class="pay">${pay}</div>
    <button class="iconbtn" data-edit="${esc(e.id)}" aria-label="Edit entry for ${longDate(e.date)}"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
  </div>`;
}

function renderLog(C){
  const f = ui.f;
  const rows = C.list.slice().reverse().filter(e => f === "all" || (e.liters > 0 && (f === "card" ? isCard(e) : f === "self" ? !isCard(e) : !(e.paid > 0))));
  if (!rows.length){ $("log").innerHTML = `<p class="empty">${loaded ? (f === "noprice" ? "Every fill-up has a price." : "Nothing here yet.") : "Loading…"}</p>`; return; }
  const groups = [];
  rows.forEach(e => { const k = monthKey(e.date); let g = groups[groups.length-1]; if (!g || g.k !== k){ g = {k, items:[]}; groups.push(g); } g.items.push(e); });
  $("log").innerHTML = groups.map(g => {
    const fl = g.items.filter(e => e.liters > 0), paid = sum(fl, e => e.paid > 0 ? e.paid : 0);
    const [y,m] = g.k.split("-").map(Number);
    return `<div class="group-h"><h3>${MONL[m-1]} ${y}</h3><span>${fl.length} fill-ups · ${fmt(vOut(sum(fl, e => e.liters)),1)} ${vU()} · ${money(paid)}</span></div>
      <div class="list">${g.items.map(e => entryRow(e, C)).join("")}</div>`;
  }).join("");
}

/* ---------- fuel card limit ---------- */
// Each user sets their own monthly fuel card limit (liters or an amount) in Settings.
// It starts over on the 1st: usage is the fill-ups marked "fuel card" in that month.
const limitType = () => settings.cardType === "amount" ? "amount" : "liters";
const limitValue = () => limitType() === "amount" ? (settings.cardAmount || 0) : (settings.cardLiters || 0);
const hasLimit = () => limitValue() > 0;
const showLimit = v => limitType() === "amount" ? money(v, 0) : fmt(vOut(v), 1) + " " + vU();
function cardMonth(list, mk, series, exceptId){
  const fills = list.filter(e => monthKey(e.date) === mk && e.liters > 0 && isCard(e) && e.id !== exceptId);
  const liters = sum(fills, e => e.liters);
  const amount = sum(fills, e => e.paid > 0 ? e.paid : e.liters * (priceOn(series, e.date) || 0));
  const used = limitType() === "amount" ? amount : liters, limit = limitValue();
  return {liters, amount, used, limit, left: Math.max(0, limit - used)};
}
function renderLimit(C){
  const box = $("limitCard");
  box.hidden = !hasLimit();
  if (box.hidden) return;
  const mk = monthKey(todayIso()), m = +mk.slice(5);
  const u = cardMonth(C.list, mk, priceSeries(C.list));
  const pct = Math.min(100, u.used / u.limit * 100);
  $("lcLeft").textContent = showLimit(u.left);
  $("lcBar").style.width = pct + "%";
  $("lcMeter").setAttribute("aria-valuenow", Math.round(pct));
  box.classList.toggle("full", u.left <= 0);
  $("lcUsed").textContent = showLimit(u.used) + " / " + showLimit(u.limit) + " · resets 1 " + MON[m % 12];
}

/* ---------- fuel prices & forecast ---------- */
const DAY_MS = 864e5;
const dayNum = s => { const [y,m,d] = s.split("-").map(Number); return Date.UTC(y, m-1, d) / DAY_MS; };
const dayStr = n => new Date(n * DAY_MS).toISOString().slice(0, 10);
const perUnit = pricePerL => pricePerL / vOut(1);   // price per liter → per liter or gallon shown
const RECENT_DAYS = 60;

// Price per liter by date: the shared price table in the chosen currency, else what you paid.
function priceSeries(list){
  const code = curCode(settings.currency);
  const table = prices.filter(p => p.currency === code);
  if (table.length) return table;
  return list.filter(e => e.liters > 0 && e.paid > 0).map(e => ({date: e.date, price: e.paid / e.liters}));
}
function priceOn(series, date){
  let p = null;
  for (const x of series){ if (x.date <= date) p = x.price; else break; }
  return p ?? (series[0] ? series[0].price : null);
}
// Straight-line trend over the last 60 days of prices, starting from the latest price.
function priceTrend(series){
  if (!series.length) return null;
  const last = series[series.length-1], t0 = dayNum(last.date);
  const w = series.filter(x => t0 - dayNum(x.date) <= RECENT_DAYS);
  let slope = 0;
  if (w.length >= 3){
    const mx = sum(w, x => dayNum(x.date)) / w.length, my = sum(w, x => x.price) / w.length;
    const den = sum(w, x => (dayNum(x.date) - mx) ** 2);
    slope = den ? sum(w, x => (dayNum(x.date) - mx) * (x.price - my)) / den : 0;
  }
  const at = d => d <= t0 ? priceOn(series, dayStr(d)) : Math.min(last.price * 1.25, Math.max(last.price * 0.8, last.price + slope * (d - t0)));
  return {last, slope, at};
}
// Liters and cost of a month's fill-ups, split by who they're marked as paid by.
function splitMonth(fills, series){
  let cardL = 0, meL = 0, cardRs = 0, meRs = 0;
  for (const e of fills){
    const cost = e.paid > 0 ? e.paid : e.liters * (priceOn(series, e.date) || 0);
    if (isCard(e)){ cardL += e.liters; cardRs += cost; } else { meL += e.liters; meRs += cost; }
  }
  return {cardL, meL, cardRs, meRs};
}
// Liters the fuel card can still cover: a liter limit directly, an amount limit at the given price.
const cardCapLiters = (left, price) => limitType() === "amount" ? (price > 0 ? left / price : 0) : left;
function drivingRates(C){
  const {list, segs} = C;
  if (list.length < 2 || !segs.length) return null;
  const last = list[list.length-1], lastDay = dayNum(last.date);
  let win = list.filter(e => lastDay - dayNum(e.date) <= RECENT_DAYS);
  if (win.length < 2) win = list.slice(-10);
  const span = dayNum(win[win.length-1].date) - dayNum(win[0].date);
  if (span < 1) return null;
  const kmPerDay = (win[win.length-1].odo - win[0].odo) / span;
  let rs = segs.filter(s => dayNum(segs[segs.length-1].date) - dayNum(s.date) <= RECENT_DAYS);
  if (rs.length < 2) rs = segs;
  const kmPerL = sum(rs, s => s.dist) / sum(rs, s => s.lit);
  let full = list.filter(e => e.liters > 0 && !e.partial && lastDay - dayNum(e.date) <= RECENT_DAYS);
  if (!full.length) full = list.filter(e => e.liters > 0);
  const perFill = sum(full, e => e.liters) / full.length;
  return kmPerDay > 0 && kmPerL > 0 && perFill > 0 ? {kmPerDay, kmPerL, perFill} : null;
}
function projectDays(r, trend, from, to){
  const days = to - from + 1, km = r.kmPerDay * days, L = km / r.kmPerL;
  const price = trend ? trend.at((from + to) / 2) : null;
  return {days, km, L, fills: L / r.perFill, price, cost: price != null ? L * price : null};
}
function withCard(p, allowanceLeft){
  const cardL = Math.min(allowanceLeft, p.L), meL = p.L - cardL;
  return {...p, cardL, meL, cardRs: p.price != null ? cardL * p.price : null, meRs: p.price != null ? meL * p.price : null};
}

function renderForecast(C){
  const box = $("forecast");
  const r = drivingRates(C);
  if (!r){ box.hidden = true; return; }
  box.hidden = false;
  const series = priceSeries(C.list), trend = priceTrend(series);
  const today = todayIso(), T = dayNum(today), mk = monthKey(today);
  const [y, m] = mk.split("-").map(Number);
  const monthEnd = dayNum(iso(new Date(y, m, 0)));
  const nextStart = monthEnd + 1, nextEnd = dayNum(iso(new Date(y, m + 1, 0)));
  const nextKey = dayStr(nextStart).slice(0, 7);

  const monthFills = C.list.filter(e => monthKey(e.date) === mk && e.liters > 0);
  const act = splitMonth(monthFills, series);
  const cardNow = cardMonth(C.list, mk, series);
  const actKm = (() => { const inM = C.list.filter(e => monthKey(e.date) === mk), before = C.list.filter(e => monthKey(e.date) < mk).pop();
    return inM.length ? inM[inM.length-1].odo - (before ? before.odo : inM[0].odo) : 0; })();

  const restP = projectDays(r, trend, T, monthEnd), nextP = projectDays(r, trend, nextStart, nextEnd);
  const rest = withCard(restP, hasLimit() ? cardCapLiters(cardNow.left, restP.price) : 0);
  const next = withCard(nextP, hasLimit() ? cardCapLiters(limitValue(), nextP.price) : 0);
  const total = {
    km: actKm + rest.km, L: sum(monthFills, e => e.liters) + rest.L, fills: monthFills.length + rest.fills,
    cardL: act.cardL + rest.cardL, meL: act.meL + rest.meL,
    cardRs: act.cardRs + (rest.cardRs || 0), meRs: act.meRs + (rest.meRs || 0),
    price: trend ? trend.at(Math.round((dayNum(mk + "-01") + monthEnd) / 2)) : null,
  };
  total.cost = total.cardRs + total.meRs;

  const card = (title, range, p) => {
    const cost = p.cost ?? ((p.cardRs || 0) + (p.meRs || 0));
    const tot = (p.cardRs || 0) + (p.meRs || 0);
    return `<div class="fc">
      <div class="fc-h"><span class="lbl">${title}</span><span class="fc-range">${range}</span></div>
      <div class="fc-big">${p.price != null || cost ? money(cost, 0) : "–"}</div>
      <div class="stack" aria-hidden="true">${tot > 0 ? `<span style="width:${p.cardRs/tot*100}%;background:var(--card)"></span><span style="width:${p.meRs/tot*100}%;background:var(--me)"></span>` : ""}</div>
      <dl class="fc-rows">
        <div><dt>Distance</dt><dd>${fmt(dOut(p.km), 0)} ${dU()}</dd></div>
        <div><dt>Fuel</dt><dd>${fmt(vOut(p.L), 1)} ${vU()}</dd></div>
        <div><dt>Fill-ups</dt><dd>${Math.round(p.fills)}</dd></div>
        <div class="card-only"><dt><i class="dot" style="background:var(--card)"></i>Fuel card</dt><dd>${fmt(vOut(p.cardL), 1)} ${vU()} · ${money(p.cardRs || 0, 0)}</dd></div>
        <div class="card-only"><dt><i class="dot" style="background:var(--me)"></i>Me</dt><dd>${fmt(vOut(p.meL), 1)} ${vU()} · <b>${money(p.meRs || 0, 0)}</b></dd></div>
        <div><dt>Price / ${vU()}</dt><dd>${p.price != null ? money(perUnit(p.price)) : "–"}</dd></div>
      </dl>
    </div>`;
  };
  const rangeTxt = (a, b) => shortDate(dayStr(a)) + (a === b ? "" : " – " + shortDate(dayStr(b)));
  renderNextFill(C, r, trend, series, T);
  $("fcGrid").innerHTML =
    card("Rest of " + MONL[m-1], rangeTxt(T, monthEnd), rest) +
    card(MONL[m-1] + " total", rangeTxt(dayNum(mk + "-01"), monthEnd), total) +
    card(MONL[+nextKey.slice(5) - 1], rangeTxt(nextStart, nextEnd), next);
  $("fcRate").innerHTML =
    `<span><b>${fmt(dOut(r.kmPerDay), 0)}</b> ${dU()}/day</span><span><b>${fmt(econ(r.kmPerL, 1))}</b> ${econUnit()}</span>` +
    `<span><b>${fmt(vOut(r.perFill), 1)}</b> ${vU()}/fill-up</span>` + (hasLimit() ? `<span><b>${limitType() === "amount" ? money(limitValue(), 0) : fmt(vOut(limitValue()), 0) + " " + vU()}</b> card/month</span>` : "");

  const pc = $("priceChart").closest(".fc-price");
  pc.hidden = !trend;
  if (trend) renderPriceChart(series, trend, nextEnd);
}

// Next fill-up: one tank lasts about (liters per fill-up × km/L) km, which at the
// recent km/day gives the days between fill-ups, counted from the last one.
function renderNextFill(C, r, trend, series, T){
  const box = $("fcNext");
  const last = C.list.filter(e => e.liters > 0).pop();
  if (!last){ box.hidden = true; return; }
  box.hidden = false;
  const kmPerTank = r.perFill * r.kmPerL, daysPerTank = kmPerTank / r.kmPerDay;
  const due = dayNum(last.date) + daysPerTank, left = due - T;
  let when, from, to;
  if (left < 0.5){ when = left < -1.5 ? "Overdue" : "Due today"; from = to = T; }
  else {
    from = Math.max(1, Math.floor(left)); to = Math.max(from, Math.ceil(left));
    when = from === to ? (from === 1 ? "Tomorrow" : "In " + from + " days") : "In " + from + "–" + to + " days";
    from += T; to += T;
  }
  const dates = from === to ? shortDate(dayStr(from))
    : dayStr(from).slice(5, 7) === dayStr(to).slice(5, 7) ? +dayStr(from).slice(8) + "–" + shortDate(dayStr(to)) : shortDate(dayStr(from)) + " – " + shortDate(dayStr(to));
  const dueDate = dayStr(Math.max(T, Math.round(due)));
  const price = trend ? trend.at(dayNum(dueDate)) : priceOn(series, dueDate);
  const cost = price ? r.perFill * price : null;
  let payerChip = "";
  if (hasLimit()){
    const u = cardMonth(C.list, monthKey(dueDate), series);
    const need = limitType() === "amount" ? (cost || 0) : r.perFill;
    const onCard = u.left > 0 && u.left >= need / 2;
    payerChip = `<span class="chip ${onCard ? "card" : "self"}">${onCard ? "Fuel card" : "Me"}</span>`;
  }
  box.classList.toggle("due", left < 0.5);
  box.innerHTML = `<svg width="30" height="30" viewBox="0 0 34 34" aria-hidden="true"><path d="M11 25V10a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M9.5 25h13M13 12h6v4h-6zM21 15l3 2.5v5a1.3 1.3 0 0 0 2.6 0V13l-2.4-2.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div class="fn-when"><span class="lbl">Next fill-up</span><b>${when}</b></div>
    <div class="fn-facts"><span>${dates}</span><span>~${fmt(dOut(last.odo + kmPerTank), 0)} ${dU()}</span><span>${fmt(vOut(r.perFill), 1)} ${vU()}</span>${cost ? `<span><b>${money(cost, 0)}</b></span>` : ""}${payerChip}</div>`;
}

function renderPriceChart(series, trend, endDay){
  const el = $("priceChart");
  const t0 = dayNum(trend.last.date), start = t0 - 120;
  const past = series.filter(x => dayNum(x.date) >= start).map(x => ({d: dayNum(x.date), v: perUnit(x.price)}));
  const future = [];
  for (let d = t0; d <= endDay; d += 3) future.push({d, v: perUnit(trend.at(d))});
  future.push({d: endDay, v: perUnit(trend.at(endDay))});
  const all = past.concat(future), vals = all.map(p => p.v);
  const W = Math.max(280, el.clientWidth || 600), H = 190, L = 58, R = 12, T = 12, B = 24;
  const {lo, hi, step} = niceScale(Math.min(...vals), Math.max(...vals), 4);
  const d0 = past.length ? past[0].d : t0;
  const x = d => L + (d - d0) / Math.max(1, endDay - d0) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let g = "";
  for (let v = lo; v <= hi + 1e-9; v += step) g += `<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--grid)"/><text x="${L-6}" y="${y(v)+4}" text-anchor="end">${esc(money(v, 0))}</text>`;
  const m = new Date((d0 + 1) * DAY_MS); m.setUTCDate(1); m.setUTCMonth(m.getUTCMonth() + 1);
  while (m.getTime() / DAY_MS <= endDay){ const xx = x(m.getTime() / DAY_MS);
    g += `<line x1="${xx}" x2="${xx}" y1="${T}" y2="${H-B}" style="stroke:var(--grid)" stroke-dasharray="2 3"/><text x="${xx}" y="${H-7}" text-anchor="middle">${MON[m.getUTCMonth()]}</text>`;
    m.setUTCMonth(m.getUTCMonth() + 1); }
  const line = pts => pts.map((p, i) => (i ? "L" : "M") + x(p.d).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
  // Prices change in steps, so the history is drawn as a step line.
  const steps = past.flatMap((p, i) => i ? [{d: p.d, v: past[i-1].v}, p] : [p]);
  if (steps.length) steps.push({d: t0, v: steps[steps.length-1].v});
  g += `<line x1="${x(t0)}" x2="${x(t0)}" y1="${T}" y2="${H-B}" style="stroke:var(--line)"/>`;
  g += `<path d="${line(steps)}" fill="none" style="stroke:var(--ink)" stroke-width="2"/>`;
  g += `<path d="${line(future)}" fill="none" style="stroke:var(--accent)" stroke-width="2.2" stroke-dasharray="6 5"/>`;
  const endV = future[future.length-1];
  g += `<circle cx="${x(t0)}" cy="${y(perUnit(trend.last.price))}" r="4.5" style="fill:var(--ink)"/><circle cx="${x(endV.d)}" cy="${y(endV.v)}" r="4.5" style="fill:var(--accent)"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fuel price per ${vU()} and forecast" style="height:${H}px">${g}</svg>`;
  $("fcPriceMeta").innerHTML = `<span><b>${money(perUnit(trend.last.price))}</b> ${shortDate(trend.last.date)}</span>` +
    `<span style="color:var(--accent)"><b>${money(endV.v)}</b> ${shortDate(dayStr(endV.d))}</span>` +
    `<span>${trend.slope >= 0 ? "▲" : "▼"} ${money(Math.abs(perUnit(trend.slope)) * 30, 0)}/month</span>`;
}

/* ---------- calendar ---------- */
let calMonth = null, calSel = null; // "YYYY-MM" shown, "YYYY-MM-DD" selected
const WEEKDAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
function shiftMonth(k, n){ const [y,m] = k.split("-").map(Number); return iso(new Date(y, m-1+n, 1)).slice(0,7); }

function renderCalendar(C){
  const today = todayIso();
  if (!calMonth) calMonth = monthKey(today);
  const [y,m] = calMonth.split("-").map(Number);
  $("calTitle").textContent = MONL[m-1] + " " + y;
  $("calToday").hidden = calMonth === monthKey(today);

  const byDay = {};
  C.list.forEach(e => { if (monthKey(e.date) === calMonth) (byDay[e.date] ||= []).push(e); });
  const svcDay = {};
  serviceEvents().forEach(x => { if (monthKey(x.date) === calMonth) (svcDay[x.date] ||= []).push(x); });
  const monthSvc = Object.values(svcDay).flat();

  const fl = C.list.filter(e => monthKey(e.date) === calMonth && e.liters > 0);
  const ma = agg(C.segs.filter(s => monthKey(s.date) === calMonth));
  $("calSum").innerHTML = fl.length
    ? `<span><b>${fl.length}</b> fill-ups</span><span><b>${fmt(vOut(sum(fl, e => e.liters)),1)}</b> ${vU()}</span>` +
      `<span><b>${fmt(ma.e)}</b> ${econUnit()} average</span><span><b>${money(sum(fl, e => e.paid > 0 ? e.paid : 0))}</b> spent</span>`
    : `<span>No fill-ups in ${MONL[m-1]} ${y}.</span>`;
  if (monthSvc.length){
    const svcCost = sum(monthSvc, x => x.cost || 0);
    $("calSum").innerHTML += `<span class="cal-sum-svc">${WRENCH_SM}<b>${monthSvc.length}</b> service${monthSvc.length > 1 ? "s" : ""}${svcCost ? " · <b>" + money(svcCost, 0) + "</b>" : ""}</span>`;
  }

  const lead = (new Date(y, m-1, 1).getDay() + 6) % 7, days = new Date(y, m, 0).getDate();
  let h = WEEKDAYS.map(d => `<div class="cal-wd" role="columnheader">${d}</div>`).join("");
  for (let i = 0; i < lead; i++) h += `<div class="cal-pad" aria-hidden="true"></div>`;
  for (let d = 1; d <= days; d++){
    const ds = calMonth + "-" + String(d).padStart(2,"0"), es = byDay[ds] || [];
    const cls = ["cal-d"];
    if (ds === today) cls.push("today");
    if (ds === calSel) cls.push("sel");
    if (es.length) cls.push("has");
    const sv = svcDay[ds] || [];
    if (sv.length) cls.push("svc-day");
    // Tint the day by who paid: fuel card, me, or both.
    const fl = es.filter(e => e.liters > 0), anyCard = fl.some(isCard), anyMe = fl.some(e => !isCard(e));
    if (anyCard && anyMe) cls.push("pay-both"); else if (anyCard) cls.push("pay-card"); else if (anyMe) cls.push("pay-me");
    if (ds > today) cls.push("future");
    const marks = es.slice(0, 2).map(e => {
      if (!(e.liters > 0)) return `<span class="cal-m read">Reading</span>`;
      const s = C.segById[e.id], ev = s ? econ(s.dist, s.lit) : null;
      return `<span class="cal-m ${rating(ev, C.overall.e)}"><i class="dot" style="background:var(--${isCard(e) ? "card" : "me"})"></i>` +
        `<span class="cal-v">${fmt(vOut(e.liters),1)} ${vU()}</span>${ev != null ? `<b>${fmt(ev)}</b>` : ""}</span>`;
    }).join("") + (es.length > 2 ? `<span class="cal-more">+${es.length - 2} more</span>` : "") +
      (sv.length ? `<span class="cal-s">${WRENCH_SM}<span class="cal-sn">${esc(sv[0].name)}${sv.length > 1 ? " +" + (sv.length - 1) : ""}</span></span>` : "");
    const label = longDate(ds) + (es.length ? ", " + es.length + (es.length > 1 ? " entries" : " entry") : "") + (sv.length ? ", " + sv.map(x => x.name).join(", ") : "");
    h += `<button type="button" class="${cls.join(" ")}" data-day="${ds}" aria-label="${label}" aria-pressed="${ds === calSel}"><span class="cal-n">${d}</span>${marks}</button>`;
  }
  $("cal").innerHTML = h;

  // Entries for the selected day, with edit / price / payer controls from the log.
  const box = $("calDay");
  box.hidden = !calSel || monthKey(calSel) !== calMonth;
  if (box.hidden) return;
  const es = byDay[calSel] || [], sv = svcDay[calSel] || [];
  box.innerHTML = `<div class="calday-h"><h3>${longDate(calSel)}</h3><button class="btn ghost" type="button" data-addon="${calSel}">＋ Add fill-up on this day</button></div>` +
    (es.length ? `<div class="list">${es.slice().reverse().map(e => entryRow(e, C)).join("")}</div>` : sv.length ? "" : `<p class="empty">No fill-ups on this day.</p>`) +
    (sv.length ? `<div class="cal-svc-list">${sv.map(x => `<div class="cal-svc">${WRENCH}<div><b>${esc(x.name)}</b><span>${fmt(dOut(x.odo), 0)} ${dU()}${x.note ? " · " + esc(x.note) : ""}</span></div><span class="cal-svc-cost">${x.cost != null ? money(x.cost, 0) : ""}</span></div>`).join("")}<button class="linkbtn" type="button" data-goto="service">Service →</button></div>` : "");
}
$("cal").addEventListener("click", ev => {
  const b = ev.target.closest("[data-day]"); if (!b) return;
  calSel = calSel === b.dataset.day ? null : b.dataset.day; render();
});
$("calPrev").addEventListener("click", () => { calMonth = shiftMonth(calMonth, -1); render(); });
$("calNext").addEventListener("click", () => { calMonth = shiftMonth(calMonth, 1); render(); });
$("calToday").addEventListener("click", () => { calMonth = monthKey(todayIso()); calSel = null; render(); });

/* ---------- maintenance ---------- */
// rules is null until loaded, or when the maintenance tables don't exist yet.
let rules = null, svcLog = [], editingRuleId = null, doneRuleId = null;
const SERVICE_PRESETS = [
  ["Oil change", 5000, 6], ["Oil filter", 10000, 12], ["Air filter", 15000, 12], ["Tyre rotation", 10000, null],
  ["Brake check", 20000, 12], ["Coolant", 40000, 24], ["Spark plugs", 30000, null], ["Battery check", null, 12],
];
const kmFromDist = v => ui.dist === "km" ? v : v * KM_PER_MI;              // interval typed in km or miles
const odoToKm = v => settings.odoUnit === "mi" ? v * KM_PER_MI : v;       // odometer as the car shows it
const kmToOdo = km => settings.odoUnit === "mi" ? km / KM_PER_MI : km;
function addMonths(s, n){
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(y, m - 1 + n, 1);
  t.setDate(Math.min(d, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
  return iso(t);
}
// Due point of a rule, measured from its last service against the latest odometer reading.
function ruleStatus(rule, C, rates){
  const latest = C.list[C.list.length - 1];
  const odo = latest ? Math.max(latest.odo, rule.lastKm) : rule.lastKm, T = dayNum(todayIso());
  let dueKm = null, leftKm = null, pctKm = 0, kmDay = null;
  if (rule.everyKm){
    dueKm = rule.lastKm + rule.everyKm; leftKm = dueKm - odo; pctKm = (odo - rule.lastKm) / rule.everyKm;
    if (rates && latest) kmDay = Math.max(T, Math.round(dayNum(latest.date) + leftKm / rates.kmPerDay));
  }
  let dueDate = null, leftDays = null, pctTime = 0;
  if (rule.everyMonths){
    dueDate = addMonths(rule.lastDate, rule.everyMonths); leftDays = dayNum(dueDate) - T;
    pctTime = (T - dayNum(rule.lastDate)) / Math.max(1, dayNum(dueDate) - dayNum(rule.lastDate));
  }
  const overdue = (leftKm != null && leftKm <= 0) || (leftDays != null && leftDays < 0);
  const soon = (leftKm != null && leftKm <= Math.max(500, rule.everyKm * 0.1)) || (leftDays != null && leftDays <= 14);
  const days = [kmDay, dueDate ? dayNum(dueDate) : null].filter(x => x != null);
  return {odo, dueKm, leftKm, dueDate, leftDays, kmDay, pct: Math.max(pctKm, pctTime),
    state: overdue ? "overdue" : soon ? "soon" : "ok", nextDay: days.length ? Math.min(...days) : Infinity};
}
function serviceStatuses(C){
  if (!rules || !C.list.length) return [];
  const rates = drivingRates(C);
  const rank = {overdue: 0, soon: 1, ok: 2};
  return rules.map(rule => ({rule, s: ruleStatus(rule, C, rates)}))
    .sort((a, b) => rank[a.s.state] - rank[b.s.state] || a.s.nextDay - b.s.nextDay);
}
const STATE_TEXT = {overdue: "Overdue", soon: "Due soon", ok: "OK"};
// Services to show on the calendar: the history, plus a rule's last-done date when the
// history has no entry for it (reminders saved before history was kept).
function serviceEvents(){
  if (!rules) return [];
  const ev = svcLog.slice();
  rules.forEach(r => { if (!svcLog.some(x => x.ruleId === r.id && x.date === r.lastDate)) ev.push({name: r.name, ruleId: r.id, date: r.lastDate, odo: r.lastKm, cost: null, note: ""}); });
  return ev;
}
const logsFor = rule => svcLog.filter(x => x.ruleId === rule.id).sort((a, b) => b.date.localeCompare(a.date));
const lastCostOf = rule => logsFor(rule).find(x => x.cost != null) || null;
function dueText(s, rule){
  if (rule.everyKm) return s.leftKm > 0
    ? `<b>${fmt(dOut(s.leftKm), 0)} ${dU()}</b> left`
    : `<b>${fmt(dOut(-s.leftKm), 0)} ${dU()}</b> overdue`;
  return s.leftDays >= 0 ? `<b>${s.leftDays} days</b> left` : `<b>${-s.leftDays} days</b> overdue`;
}
const WRENCH_SM = `<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.6 17.2a1.6 1.6 0 0 0 2.3 2.3l5.7-5.7a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.1-.3-.3-2.1z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
const WRENCH = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.6 17.2a1.6 1.6 0 0 0 2.3 2.3l5.7-5.7a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.1-.3-.3-2.1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

function renderServiceBadges(C){
  const due = serviceStatuses(C).filter(x => x.s.state !== "ok");
  $("svcCount").hidden = !due.length; $("svcCount").textContent = due.length;
  const a = $("svcAlert");
  a.hidden = !due.length;
  if (!due.length) return;
  const {rule, s} = due[0];
  a.className = "svc-alert dash " + s.state;
  a.innerHTML = `${WRENCH}<span><b>${esc(rule.name)}</b> · ${STATE_TEXT[s.state]} · ${dueText(s, rule)}</span>` +
    (due.length > 1 ? `<span class="muted">+${due.length - 1} more</span>` : "") + `<span class="svc-go">Service →</span>`;
}

function renderService(C){
  const ready = rules !== null;
  $("ruleAdd").disabled = !ready;
  $("svcHistoryPanel").hidden = !ready || !svcLog.length;
  const latest = C.list[C.list.length - 1];
  $("svcNow").innerHTML = latest ? `<span>Latest reading <b>${fmt(dOut(latest.odo), 0)} ${dU()}</b> · ${longDate(latest.date)}</span>` : "";
  if (!ready){
    $("svcList").innerHTML = `<p class="empty">${loaded ? "Maintenance reminders aren't set up in the database yet. Run supabase/migrations/20261004000000_fuel_maintenance.sql in the Supabase SQL Editor." : "Loading…"}</p>`;
    return;
  }
  const list = serviceStatuses(C);
  $("svcList").innerHTML = !rules.length
    ? `<div class="svc-empty"><p>Add a reminder for things like oil changes, and the app works out when each one is due from your odometer.</p>
        <div class="presets">${SERVICE_PRESETS.slice(0, 4).map((p, i) => `<button type="button" class="fchip" data-preset-new="${i}">${esc(p[0])}</button>`).join("")}</div></div>`
    : list.map(({rule, s}) => {
      const every = [rule.everyKm ? "every " + fmt(dOut(rule.everyKm), 0) + " " + dU() : "", rule.everyMonths ? (rule.everyKm ? "or " : "every ") + rule.everyMonths + (rule.everyMonths === 1 ? " month" : " months") : ""].filter(Boolean).join(" ");
      const due = [rule.everyKm ? "at " + fmt(dOut(s.dueKm), 0) + " " + dU() : "", s.dueDate ? (rule.everyKm ? "or by " : "by ") + longDate(s.dueDate) : ""].filter(Boolean).join(" ");
      const est = s.state !== "overdue" && rule.everyKm && s.kmDay != null ? `<span>~${shortDate(dayStr(s.kmDay))}</span>` : "";
      return `<div class="svc ${s.state}">
        <div class="svc-h"><h3>${esc(rule.name)}</h3><span class="pill ${s.state}">${STATE_TEXT[s.state]}</span></div>
        <div class="svc-main"><span class="svc-left">${dueText(s, rule)}</span><span class="muted">Due ${due}</span></div>
        <div class="meter svc-meter" aria-hidden="true"><span style="width:${Math.min(100, Math.max(0, s.pct * 100)).toFixed(1)}%"></span></div>
        <div class="svc-facts"><span>${every}</span>${est}<span>Last ${fmt(dOut(rule.lastKm), 0)} ${dU()} · ${longDate(rule.lastDate)}</span></div>
        ${(() => { const lc = lastCostOf(rule), all = logsFor(rule).filter(x => x.cost != null), tot = sum(all, x => x.cost);
          return lc ? `<div class="svc-paid"><span>Last paid <b>${money(lc.cost, 0)}</b> · ${longDate(lc.date)}</span>${all.length > 1 ? `<span>${money(tot, 0)} over ${all.length} services</span>` : ""}</div>` : ""; })()}
        ${rule.note ? `<div class="svc-note">${esc(rule.note)}</div>` : ""}
        <div class="svc-actions"><button class="btn" type="button" data-done="${esc(rule.id)}">Mark done</button><button class="btn ghost" type="button" data-rule-edit="${esc(rule.id)}">Edit</button></div>
      </div>`;
    }).join("");

  const total = sum(svcLog, x => x.cost || 0);
  $("svcHistMeta").innerHTML = svcLog.length ? `<span><b>${svcLog.length}</b> services</span>` + (total ? `<span><b>${money(total, 0)}</b> spent</span>` : "") : "";
  $("svcHistory").innerHTML = svcLog.length
    ? `<thead><tr><th>Date</th><th>Service</th><th class="num">Odometer</th><th class="num">Cost</th><th>Note</th><th></th></tr></thead><tbody>` +
      svcLog.map(x => `<tr><td>${longDate(x.date)}</td><td>${esc(x.name)}</td><td class="num">${fmt(dOut(x.odo), 0)} ${dU()}</td>
        <td class="num">${x.cost != null ? money(x.cost) : "–"}</td><td class="muted">${esc(x.note)}</td>
        <td><button class="rowbtn" type="button" data-svc-del="${esc(x.id)}">Delete</button></td></tr>`).join("") + "</tbody>"
    : "";
}

/* reminder form */
const ruleSheet = $("ruleSheet"), doneSheet = $("doneSheet");
const openDialog = d => d.showModal ? d.showModal() : d.setAttribute("open", "");
const closeDialog = d => d.close ? d.close() : d.removeAttribute("open");
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeDialog($(b.dataset.close))));
[ruleSheet, doneSheet].forEach(d => d.addEventListener("click", ev => { if (ev.target === d) closeDialog(d); }));
$("rulePresets").innerHTML = SERVICE_PRESETS.map((p, i) => `<button type="button" class="fchip" data-preset="${i}">${esc(p[0])}</button>`).join("");
function applyPreset(i){
  const [name, km, months] = SERVICE_PRESETS[i];
  $("rName").value = name;
  // Presets are in km; in miles they're rounded to the nearest 500.
  $("rKm").value = !km ? "" : ui.dist === "km" ? km : Math.round(km / KM_PER_MI / 500) * 500;
  $("rMonths").value = months || "";
}
$("rulePresets").addEventListener("click", ev => { const b = ev.target.closest("[data-preset]"); if (b) applyPreset(+b.dataset.preset); });
let ruleDelArmed = false;
function openRule(id, preset){
  editingRuleId = id || null; ruleDelArmed = false;
  $("ruleForm").reset(); $("rMsg").hidden = true; $("rDelete").textContent = "Delete";
  $("rKmLbl").textContent = "Every (" + dU() + ")";
  $("rLastKmLbl").textContent = "Last done at (" + settings.odoUnit + ")";
  $("rCostLbl").textContent = "Cost last time (" + curSymbol(curCode(settings.currency)) + ")";
  const latest = compute().list.pop();
  if (editingRuleId){
    const r = rules.find(x => x.id === editingRuleId);
    $("ruleTitle").textContent = "Edit reminder";
    $("rName").value = r.name;
    $("rKm").value = r.everyKm ? Math.round(dOut(r.everyKm)) : "";
    $("rMonths").value = r.everyMonths || "";
    $("rLastKm").value = Math.round(kmToOdo(r.lastKm)); $("rLastDate").value = r.lastDate; $("rNote").value = r.note || "";
    const lastLog = logsFor(r).find(x => x.date === r.lastDate);
    $("rCost").value = lastLog && lastLog.cost != null ? lastLog.cost : "";
    $("rSubmit").textContent = "Save changes"; $("rDelete").hidden = false;
  } else {
    $("ruleTitle").textContent = "Add reminder";
    $("rLastKm").value = latest ? Math.round(kmToOdo(latest.odo)) : "";
    $("rLastDate").value = latest ? latest.date : todayIso();
    $("rSubmit").textContent = "Add reminder"; $("rDelete").hidden = true;
    if (preset != null) applyPreset(preset);
  }
  $("rulePresets").hidden = !!editingRuleId;
  openDialog(ruleSheet);
  setTimeout(() => $(preset != null ? "rLastKm" : "rName").focus(), 30);
}
$("ruleAdd").addEventListener("click", () => openRule());
$("ruleForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const msg = $("rMsg"), fail = t => { msg.hidden = false; msg.textContent = t; };
  const name = $("rName").value.trim(), km = parseFloat($("rKm").value), months = parseInt($("rMonths").value, 10);
  const lastOdo = parseFloat($("rLastKm").value), lastDate = $("rLastDate").value;
  if (!name) return fail("Enter the name of the service.");
  if (!(km > 0) && !(months > 0)) return fail("Set how often: a distance, a number of months, or both.");
  if (!(lastOdo >= 0) || !lastDate) return fail("Enter when it was last done: odometer and date.");
  if (!store) return fail("You're offline. Reminders need a connection to save.");
  const rule = {name, everyKm: km > 0 ? Math.round(kmFromDist(km)) : null, everyMonths: months > 0 ? months : null,
    lastKm: Math.round(odoToKm(lastOdo)), lastDate, note: $("rNote").value.trim()};
  const wasEdit = !!editingRuleId;
  $("rSubmit").disabled = true;
  try{
    const saved = await store.saveServiceRule(rule, editingRuleId);
    const i = rules.findIndex(x => x.id === saved.id);
    if (i >= 0) rules[i] = saved; else rules.push(saved);
    // Keep the "last done" in the service history too, so it shows on the calendar with its cost.
    const cost = parseFloat($("rCost").value), costVal = cost >= 0 ? +cost.toFixed(2) : null;
    const lastLog = svcLog.find(x => x.ruleId === saved.id && x.date === saved.lastDate);
    try{
      if (lastLog){
        if (lastLog.odo !== saved.lastKm || lastLog.cost !== costVal || lastLog.name !== saved.name){
          const upd = await store.updateServiceLog(lastLog.id, {odo: saved.lastKm, cost: costVal, name: saved.name});
          svcLog[svcLog.indexOf(lastLog)] = upd;
        }
      } else {
        svcLog.push(await store.addServiceLog(saved, {date: saved.lastDate, odo: saved.lastKm, cost: costVal}));
      }
      svcLog.sort((a, b) => b.date.localeCompare(a.date));
    }catch(e){ toast("Reminder saved, but the service history couldn't be updated."); }
    closeDialog(ruleSheet); render(); keepOffline();
    toast(wasEdit ? "Reminder saved" : saved.name + " reminder added");
  }catch(e){ fail("Couldn't save. Check your connection and try again."); }
  finally{ $("rSubmit").disabled = false; }
});
$("rDelete").addEventListener("click", async () => {
  if (!ruleDelArmed){ ruleDelArmed = true; $("rDelete").textContent = "Tap again to delete"; return; }
  try{
    await store.deleteServiceRule(editingRuleId);
    rules = rules.filter(x => x.id !== editingRuleId);
    closeDialog(ruleSheet); render(); keepOffline(); toast("Reminder deleted");
  }catch(e){ $("rMsg").hidden = false; $("rMsg").textContent = "Couldn't delete. Try again."; }
});

/* mark done */
function openDone(id){
  doneRuleId = id;
  const r = rules.find(x => x.id === id), latest = compute().list.pop();
  $("doneForm").reset(); $("dMsg").hidden = true;
  $("doneTitle").textContent = r.name + " done";
  $("dOdoLbl").textContent = "Odometer (" + settings.odoUnit + ")";
  $("dCostLbl").textContent = "Cost (" + curSymbol(curCode(settings.currency)) + ")";
  $("dDate").value = todayIso();
  $("dOdo").value = Math.round(kmToOdo(latest ? Math.max(latest.odo, r.lastKm) : r.lastKm));
  openDialog(doneSheet);
  setTimeout(() => $("dOdo").focus(), 30);
}
$("doneForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const msg = $("dMsg"), fail = t => { msg.hidden = false; msg.textContent = t; };
  const date = $("dDate").value, odo = parseFloat($("dOdo").value), cost = parseFloat($("dCost").value);
  if (!date || !(odo >= 0)) return fail("Enter the date and the odometer reading.");
  if (!store) return fail("You're offline. This needs a connection to save.");
  const rule = rules.find(x => x.id === doneRuleId);
  $("dSubmit").disabled = true;
  try{
    const res = await store.markServiceDone(rule, {date, odo: Math.round(odoToKm(odo)), cost: cost >= 0 ? +cost.toFixed(2) : null, note: $("dNote").value.trim()});
    rules[rules.findIndex(x => x.id === rule.id)] = res.rule;
    svcLog.unshift(res.log); svcLog.sort((a, b) => b.date.localeCompare(a.date));
    closeDialog(doneSheet); render(); keepOffline();
    toast(rule.name + " done" + (res.rule.everyKm ? ". Next at " + fmt(dOut(res.rule.lastKm + res.rule.everyKm), 0) + " " + dU() : ""));
  }catch(e){ fail("Couldn't save. Check your connection and try again."); }
  finally{ $("dSubmit").disabled = false; }
});

let svcDelArm = null;
$("svcList").addEventListener("click", ev => {
  const d = ev.target.closest("[data-done]"), e = ev.target.closest("[data-rule-edit]"), p = ev.target.closest("[data-preset-new]");
  if (d) openDone(d.dataset.done);
  else if (e) openRule(e.dataset.ruleEdit);
  else if (p) openRule(null, +p.dataset.presetNew);
});
$("svcHistory").addEventListener("click", async ev => {
  const b = ev.target.closest("[data-svc-del]"); if (!b) return;
  const id = b.dataset.svcDel;
  if (svcDelArm !== id){ svcDelArm = id; b.textContent = "Confirm"; setTimeout(() => { if (svcDelArm === id){ svcDelArm = null; b.textContent = "Delete"; } }, 4000); return; }
  svcDelArm = null;
  try{ await store.deleteServiceLog(id); svcLog = svcLog.filter(x => x.id !== id); render(); keepOffline(); toast("Service removed from history"); }
  catch(e){ toast("Couldn't delete. Try again."); }
});

/* ---------- charts ---------- */
function niceScale(lo, hi, n){
  const raw = (hi - lo) / n || 1, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1,2,2.5,5,10].map(m => m*mag).find(s => s >= raw);
  lo = Math.floor(lo/step)*step; hi = Math.ceil(hi/step)*step; if (hi === lo) hi = lo + step;
  return {lo, hi, step};
}
let chartPts = [];
function renderChart(segs, avg){
  const el = $("chart");
  if (segs.length < 2){ el.innerHTML = '<p class="empty">The chart appears after a few full fill-ups.</p>'; $("chartMeta").textContent = ""; return; }
  const W = Math.max(280, el.clientWidth || 600), H = 230, L = 36, R = 10, T = 14, B = 26;
  const pts = segs.map(s => ({t: pd(s.date).getTime(), v: econ(s.dist, s.lit), s}));
  const vals = pts.map(p => p.v);
  const {lo, hi, step} = niceScale(Math.min(...vals), Math.max(...vals), 4);
  const t0 = pts[0].t, t1 = pts[pts.length-1].t;
  const x = t => L + (t1 === t0 ? (W-L-R)/2 : (t - t0) / (t1 - t0) * (W - L - R));
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let g = "";
  for (let v = lo; v <= hi + 1e-9; v += step)
    g += `<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--grid)"/><text x="${L-6}" y="${y(v)+4}" text-anchor="end">${fmt(v, step < 1 ? 1 : 0)}</text>`;
  const d0 = pd(segs[0].date), m = new Date(d0.getFullYear(), d0.getMonth()+1, 1), ticks = [];
  while (m.getTime() <= t1){ ticks.push(new Date(m)); m.setMonth(m.getMonth()+1); }
  const every = Math.ceil(ticks.length / Math.max(1, Math.floor((W-L-R)/70)));
  ticks.forEach((d,i) => { if (i % every) return; const xx = x(d.getTime());
    g += `<line x1="${xx}" x2="${xx}" y1="${T}" y2="${H-B}" style="stroke:var(--grid)" stroke-dasharray="2 3"/><text x="${xx}" y="${H-8}" text-anchor="middle">${MON[d.getMonth()]}</text>`; });
  if (avg) g += `<line x1="${L}" x2="${W-R}" y1="${y(avg)}" y2="${y(avg)}" style="stroke:var(--muted)" stroke-width="1.2" stroke-dasharray="5 4"/><text x="${W-R}" y="${y(avg)-6}" text-anchor="end">avg ${fmt(avg)}</text>`;
  const path = pts.map((p,i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
  g += `<path d="${path} L${x(t1).toFixed(1)} ${H-B} L${x(t0).toFixed(1)} ${H-B} Z" style="fill:var(--accent);opacity:.12"/><path d="${path}" fill="none" style="stroke:var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>`;
  pts.forEach((p,i) => { const last = i === pts.length-1;
    g += `<circle cx="${x(p.t)}" cy="${y(p.v)}" r="${last?5:3}" style="fill:${last?"var(--accent)":"var(--surface)"};stroke:var(--accent)" stroke-width="2"/>`; });
  g += `<circle id="hov" r="6" cx="-20" cy="-20" style="fill:var(--accent);stroke:var(--surface)" stroke-width="2.5"/>`;
  chartPts = pts.map(p => ({x: x(p.t), y: y(p.v), p}));
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fuel average per fill-up">${g}</svg><div class="tip" id="tip" hidden></div>`;
  $("chartMeta").innerHTML = `<span>Best <b style="color:var(--good)">${fmt(Math.max(...vals))}</b></span><span>Worst <b style="color:var(--warn)">${fmt(Math.min(...vals))}</b></span><span>${econUnit()}</span>`;
  const svg = el.querySelector("svg");
  const move = ev => {
    const rect = svg.getBoundingClientRect(), sx = (ev.clientX - rect.left) * W / rect.width;
    let best = chartPts[0]; chartPts.forEach(c => { if (Math.abs(c.x - sx) < Math.abs(best.x - sx)) best = c; });
    const hov = $("hov"); hov.setAttribute("cx", best.x); hov.setAttribute("cy", best.y);
    const tip = $("tip"), s = best.p.s; tip.hidden = false;
    tip.style.left = Math.min(rect.width - 70, Math.max(70, best.x * rect.width / W)) + "px"; tip.style.top = (best.y * rect.height / H) + "px";
    tip.innerHTML = `<b>${fmt(best.p.v)}</b> ${econUnit()}<br>${longDate(s.date)} · ${fmt(dOut(s.dist),0)} ${dU()} / ${fmt(vOut(s.lit),2)} ${vU()}`;
  };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", () => { $("tip").hidden = true; $("hov").setAttribute("cx", -20); });
}

function renderSpendChart(list){
  const el = $("spendChart");
  const byM = {};
  list.filter(e => e.liters > 0).forEach(e => { const k = monthKey(e.date); const r = byM[k] || (byM[k] = {card:0, self:0}); if (e.paid > 0) r[isCard(e) ? "card" : "self"] += e.paid; });
  const keys = Object.keys(byM).sort().slice(-12);
  const max = Math.max(0, ...keys.map(k => byM[k].card + byM[k].self));
  if (!max){ el.innerHTML = '<p class="empty">Add prices to your fill-ups to see spending by month.</p>'; return; }
  const W = Math.max(280, el.clientWidth || 600), H = 230, L = 52, R = 10, T = 14, B = 26;
  const {hi, step} = niceScale(0, max, 4);
  const y = v => T + (1 - v / hi) * (H - T - B);
  const bw = (W - L - R) / keys.length, w = Math.min(46, bw * 0.6);
  let g = "";
  for (let v = 0; v <= hi + 1e-9; v += step) g += `<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--grid)"/><text x="${L-6}" y="${y(v)+4}" text-anchor="end">${esc(money(v, 0))}</text>`;
  keys.forEach((k,i) => { const r = byM[k], cx = L + bw*i + bw/2;
    g += `<rect x="${cx-w/2}" y="${y(r.card)}" width="${w}" height="${y(0)-y(r.card)}" style="fill:var(--card)"><title>${monthLabel(k)} fuel card ${money(r.card)}</title></rect>`;
    g += `<rect x="${cx-w/2}" y="${y(r.card + r.self)}" width="${w}" height="${y(r.card)-y(r.card+r.self)}" style="fill:var(--me)"><title>${monthLabel(k)} me ${money(r.self)}</title></rect>`;
    g += `<text x="${cx}" y="${H-8}" text-anchor="middle">${MON[+k.slice(5)-1]}</text>`; });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending by month">${g}</svg>`;
}

function renderBreakdown(list, segs){
  const key = ui.per === "week" ? weekKey : monthKey, label = ui.per === "week" ? weekLabel : monthLabel;
  const g = {};
  const get = k => g[k] || (g[k] = {dist:0, lit:0, fuel:0, fills:0, card:0, self:0});
  segs.forEach(s => { const r = get(key(s.date)); r.dist += s.dist; r.lit += s.lit; });
  list.filter(e => e.liters > 0).forEach(e => { const r = get(key(e.date)); r.fuel += e.liters; r.fills++; if (e.paid > 0) r[isCard(e) ? "card" : "self"] += e.paid; });
  const keys = Object.keys(g).sort().reverse();
  if (!keys.length){ $("brk").innerHTML = `<tr><td class="empty">${loaded ? "Nothing to show yet." : "Loading…"}</td></tr>`; return; }
  $("brk").innerHTML = `<thead><tr><th>${ui.per === "week" ? "Week" : "Month"}</th><th class="num">Fill-ups</th><th class="num">Fuel</th><th class="num">Distance</th><th class="num">Average</th><th class="num card-only">Fuel card</th><th class="num card-only">Me</th><th class="num">Total</th></tr></thead><tbody>` +
    keys.map(k => { const r = g[k];
      return `<tr><td>${label(k)}</td><td class="num">${r.fills}</td><td class="num">${fmt(vOut(r.fuel),1)} ${vU()}</td>
        <td class="num">${r.dist ? fmt(dOut(r.dist),0) + " " + dU() : "–"}</td>
        <td class="num">${r.lit ? "<b>" + fmt(econ(r.dist, r.lit)) + '</b> <span class="muted">' + econUnit() + "</span>" : "–"}</td>
        <td class="num card-only" style="color:var(--card)">${money(r.card)}</td><td class="num card-only" style="color:var(--me)">${money(r.self)}</td><td class="num"><b>${money(r.card + r.self)}</b></td></tr>`; }).join("") + "</tbody>";
}

/* ---------- status & toast ---------- */
function status(msg){ $("status").textContent = msg || ""; $("status").hidden = !msg; }
let toastTimer = null, undoFn = null;
function toast(msg, undo){
  $("toastText").textContent = msg; undoFn = undo || null; $("toastUndo").hidden = !undo; $("toast").hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("toast").hidden = true; undoFn = null; }, undo ? 6000 : 2600);
}
$("toastUndo").addEventListener("click", () => { const f = undoFn; $("toast").hidden = true; undoFn = null; if (f) f(); });

/* ---------- storage (Supabase) ---------- */
function upsertLocal(row){ const i = entries.findIndex(e => e.id === row.id); if (i >= 0) entries[i] = row; else entries.push(row); render(); keepOffline(); }
const keepOffline = () => { if (currentUser) saveOffline(currentUser); };
// Adds when id is null; re-creates a deleted entry when restoring (undo).
async function writeEntry(id, body, restoring){
  const row = id && !restoring ? await store.updateEntry(id, body) : await store.addEntry(body, id);
  upsertLocal(row);
}
async function patchEntry(id, patch){
  const e = entries.find(x => x.id === id); if (!e) return;
  await store.setPayer(id, patch.payer);
  Object.assign(e, patch); render(); keepOffline();
}
async function removeEntry(id){
  await store.deleteEntry(id);
  entries = entries.filter(e => e.id !== id); render(); keepOffline();
}
let settingsTimer = null;
function saveSettings(){
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    try{ await store.saveSettings(settings); keepOffline(); }catch(e){ toast("Couldn't save settings. Try again."); }
  }, 500);
}
const bodyOf = e => ({date:e.date, odo:e.odo, liters:e.liters ?? null, paid:e.paid ?? null, payer:e.payer || "self", partial:!!e.partial, note:e.note || ""});

/* ---------- sheet ---------- */
const sheet = $("sheet");
function setPayer(p){ payer = p; document.querySelectorAll(".payer button").forEach(b => b.setAttribute("aria-pressed", b.dataset.p === p)); }
function openSheet(id, focus, date){
  editingId = id || null;
  $("form").reset(); $("fMsg").hidden = true; delArmed = false; $("fDelete").textContent = "Delete";
  $("fOdoLbl").textContent = "Odometer (" + settings.odoUnit + ")";
  $("fVolLbl").textContent = "Fuel (" + vU() + ")";
  renderCurrency();
  const list = compute().list, last = list[list.length-1];
  $("fOdo").placeholder = last ? "Last: " + (settings.odoUnit === "mi" ? Math.round(last.odo / KM_PER_MI) : last.odo) : "e.g. 84120";
  if (editingId){
    const e = entries.find(x => x.id === editingId);
    $("sheetTitle").textContent = "Edit · " + longDate(e.date);
    $("fDate").value = e.date;
    $("fOdo").value = settings.odoUnit === "mi" ? Math.round(e.odo / KM_PER_MI) : e.odo;
    $("fVol").value = e.liters > 0 ? +vOut(e.liters).toFixed(2) : "";
    $("fPaid").value = e.paid > 0 ? e.paid : "";
    $("fPpu").value = e.paid > 0 && e.liters > 0 ? (e.paid / vOut(e.liters)).toFixed(3) : "";
    setPayer(isCard(e) ? "card" : "self");
    $("fPartial").checked = !!e.partial; $("fNote").value = e.note || "";
    $("fSubmit").textContent = "Save changes"; $("fDelete").hidden = false;
  } else {
    $("sheetTitle").textContent = "Add fill-up"; $("fDate").value = date || todayIso(); payerTouched = false; autoPayer();
    $("fSubmit").textContent = "Add fill-up"; $("fDelete").hidden = true;
  }
  lastPriceEdit = "paid";
  autoPpu = !editingId; autoPrice(); autoPayer();
  updatePreview();
  if (sheet.showModal) sheet.showModal(); else sheet.setAttribute("open", "");
  setTimeout(() => $(focus || (editingId ? "fPaid" : "fOdo")).focus(), 30);
}
function closeSheet(){ if (sheet.close) sheet.close(); else sheet.removeAttribute("open"); editingId = null; }
$("sheetClose").addEventListener("click", closeSheet);
$("fCancel").addEventListener("click", closeSheet);
sheet.addEventListener("click", ev => { if (ev.target === sheet) closeSheet(); });
$("addTop").addEventListener("click", () => openSheet());
$("fab").addEventListener("click", () => openSheet());

function updatePreview(){
  const pv = $("preview"); pv.className = "preview";
  const raw = parseFloat($("fOdo").value);
  if (!(raw > 0)){ pv.textContent = "Enter the odometer reading to see the distance since your last fill-up."; return; }
  const odo = settings.odoUnit === "mi" ? raw * KM_PER_MI : raw;
  const others = compute().list.filter(e => e.id !== editingId);
  const prev = others.filter(e => e.odo < odo).pop();
  const anchor = others.filter(e => e.odo < odo && e.liters > 0 && !e.partial).pop();
  const later = others.filter(e => e.odo >= odo && e.date < $("fDate").value).pop();
  if (later){ pv.className = "preview warn"; pv.textContent = "This is lower than " + fmt(dOut(later.odo),0) + " " + dU() + " logged on " + longDate(later.date) + ". Check the reading."; return; }
  if (!prev){ pv.textContent = "This will be your first entry."; return; }
  const vol = parseFloat($("fVol").value);
  let html = `<span><b>${fmt(dOut(odo - prev.odo),0)}</b> ${dU()} since ${shortDate(prev.date)}</span>`;
  if (vol > 0 && anchor && !$("fPartial").checked){
    const pendL = sum(others.filter(e => e.odo > anchor.odo && e.odo < odo && e.liters > 0 && e.partial), e => e.liters);
    const ev = econ(odo - anchor.odo, pendL + vIn(vol));
    const avg = compute().overall.e;
    const r = rating(ev, avg);
    html += `<span>≈ <b style="color:${r === "good" ? "var(--good)" : r === "poor" ? "var(--warn)" : "var(--ink)"}">${fmt(ev)}</b> ${econUnit()}${avg ? " (avg " + fmt(avg) + ")" : ""}</span>`;
  } else if ($("fPartial").checked) html += `<span>Partial fill: counted with your next full tank.</span>`;
  pv.innerHTML = html;
}
function syncPrice(){
  const v = parseFloat($("fVol").value), paid = parseFloat($("fPaid").value), ppu = parseFloat($("fPpu").value);
  if (!(v > 0)) return;
  if (lastPriceEdit === "ppu" && ppu > 0) $("fPaid").value = (ppu * v).toFixed(2);
  else if (lastPriceEdit === "paid" && paid > 0) $("fPpu").value = (paid / v).toFixed(3);
}
$("fPaid").addEventListener("input", () => { lastPriceEdit = "paid"; syncPrice(); autoPayer(); });
$("fPpu").addEventListener("input", () => { lastPriceEdit = "ppu"; autoPpu = false; syncPrice(); });
// New fill-ups start with the fuel price for their date; typing a price turns this off.
let autoPpu = false;
function autoPrice(){
  if (editingId || !autoPpu) return;
  const p = priceOn(priceSeries(compute().list), $("fDate").value || todayIso());
  if (p == null) return;
  $("fPpu").value = perUnit(p).toFixed(2); lastPriceEdit = "ppu"; syncPrice();
}
["fOdo","fDate","fVol"].forEach(id => $(id).addEventListener("input", () => { if (id === "fVol") syncPrice(); if (id === "fDate") autoPrice(); if (id !== "fOdo") autoPayer(); updatePreview(); }));
$("fPartial").addEventListener("change", updatePreview);
document.querySelectorAll(".payer button").forEach(b => b.addEventListener("click", () => { payerTouched = true; setPayer(b.dataset.p); }));
// New fill-ups go on the fuel card while this month's limit has room (at least half the fill-up).
let payerTouched = false;
function autoPayer(){
  const date = $("fDate").value || todayIso(), list = compute().list, series = priceSeries(list);
  const u = cardMonth(list, monthKey(date), series, editingId);
  $("fCardLeft").textContent = hasLimit() ? showLimit(u.left) + " left on card in " + MON[+date.slice(5,7) - 1] : "";
  if (editingId || payerTouched) return;
  if (!hasLimit()){ setPayer("self"); return; }
  const L = vIn(parseFloat($("fVol").value) || 0), paid = parseFloat($("fPaid").value) || 0;
  const need = limitType() === "amount" ? (paid || L * (priceOn(series, date) || 0)) : L;
  setPayer(u.left > 0 && u.left >= need / 2 ? "card" : "self");
}

$("form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const msg = $("fMsg");
  const date = $("fDate").value, odoRaw = parseFloat($("fOdo").value);
  if (!date || !(odoRaw > 0)){ msg.hidden = false; msg.textContent = "Enter the date and the odometer reading."; return; }
  const volRaw = parseFloat($("fVol").value), paid = parseFloat($("fPaid").value);
  const body = {date, odo: Math.round(settings.odoUnit === "mi" ? odoRaw * KM_PER_MI : odoRaw),
    liters: volRaw > 0 ? +vIn(volRaw).toFixed(3) : null, paid: paid > 0 ? +paid.toFixed(2) : null,
    payer, partial: $("fPartial").checked, note: $("fNote").value.trim()};
  const wasEdit = !!editingId;
  $("fSubmit").disabled = true;
  try{ await writeEntry(editingId, body); closeSheet(); toast(wasEdit ? "Changes saved" : "Fill-up added"); }
  catch(e){ msg.hidden = false; msg.textContent = "Couldn't save. Check your connection and try again."; }
  finally{ $("fSubmit").disabled = false; }
});
let delArmed = false;
$("fDelete").addEventListener("click", async () => {
  if (!delArmed){ delArmed = true; $("fDelete").textContent = "Tap again to delete"; return; }
  const id = editingId, e = entries.find(x => x.id === id); if (!e) return;
  const body = bodyOf(e);
  try{ await removeEntry(id); closeSheet(); toast("Entry deleted", () => writeEntry(id, body, true).catch(() => toast("Couldn't restore it."))); }
  catch(err){ $("fMsg").hidden = false; $("fMsg").textContent = "Couldn't delete. Try again."; }
});

/* ---------- list actions ---------- */
document.addEventListener("click", async ev => {
  const t = ev.target.closest("[data-toggle],[data-price],[data-edit],[data-goto],[data-addon]");
  if (!t) return;
  if (t.dataset.goto){ ui.tab = t.dataset.goto; saveUi(); render(); scrollTo(0,0); return; }
  if (t.dataset.addon) return openSheet(null, null, t.dataset.addon);
  if (t.dataset.edit) return openSheet(t.dataset.edit);
  if (t.dataset.price) return openSheet(t.dataset.price, "fPaid");
  if (t.dataset.toggle){
    const e = entries.find(x => x.id === t.dataset.toggle); if (!e) return;
    const next = isCard(e) ? "self" : "card";
    t.disabled = true;
    try{ await patchEntry(e.id, {payer: next}); toast(shortDate(e.date) + " marked as " + (next === "card" ? "fuel card" : "paid by me")); }
    catch(err){ toast("Couldn't update. Try again."); t.disabled = false; }
  }
});

/* ---------- switches, tabs, settings ---------- */
function bind(attr, key, after){
  document.querySelectorAll("[data-" + attr + "]").forEach(b => b.addEventListener("click", () => { ui[key] = b.dataset[attr]; saveUi(); render(); if (after) after(); }));
}
bind("dist", "dist"); bind("vol", "vol"); bind("per", "per"); bind("f", "f"); bind("tab", "tab");
$("todoGo").addEventListener("click", () => { ui.tab = "log"; ui.f = "noprice"; saveUi(); render(); scrollTo(0,0); });
$("sCur").addEventListener("change", () => setCurrency($("sCur").value));
$("fCur").addEventListener("change", () => setCurrency($("fCur").value));
$("curQuick").addEventListener("click", ev => { const b = ev.target.closest("[data-cur]"); if (b) setCurrency(b.dataset.cur); });
$("sGal").addEventListener("change", () => { settings.gallon = $("sGal").value; render(); saveSettings(); });
$("sOdo").addEventListener("change", () => { settings.odoUnit = $("sOdo").value; render(); saveSettings(); });
document.querySelectorAll("[data-ltype]").forEach(b => b.addEventListener("click", () => {
  if (limitType() === b.dataset.ltype) return;
  settings.cardType = b.dataset.ltype; render(); saveSettings();
}));
$("sLimit").addEventListener("change", () => {
  const v = parseFloat($("sLimit").value), val = v > 0 ? v : 0;
  if (limitType() === "amount") settings.cardAmount = +val.toFixed(2); else settings.cardLiters = +vIn(val).toFixed(2);
  render(); saveSettings();
  toast(val ? "Fuel card limit set to " + showLimit(limitValue()) + " a month" : "Fuel card limit removed");
});
$("sLimitClear").addEventListener("click", () => {
  settings.cardLiters = 0; settings.cardAmount = 0; render(); saveSettings(); toast("Fuel card limit removed");
});
let rz = null;
window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(render, 150); });

/* ---------- account ---------- */
function showScreen(name){
  $("splash").hidden = name !== "splash";
  $("signin").hidden = name !== "signin";
  $("app").hidden = name !== "app";
}
function showSigninError(text){ $("signinErr").textContent = text; $("signinErr").hidden = !text; }
$("googleSignIn").addEventListener("click", async () => {
  const b = $("googleSignIn"); b.disabled = true; showSigninError("");
  try{ await signInWithGoogle(); } // navigates away to Google
  catch(e){ b.disabled = false; showSigninError("Couldn't start Google sign-in. Check your connection and try again."); }
});
function renderAccount(user){
  const m = user.user_metadata || {};
  const name = m.full_name || m.name || (user.email || "").split("@")[0];
  $("accountName").textContent = name;
  $("accountEmail").textContent = user.email || "";
  const btn = $("accountBtn"), pic = m.avatar_url || m.picture;
  btn.textContent = pic ? "" : (name[0] || "?").toUpperCase();
  btn.style.backgroundImage = pic ? `url("${pic.replace(/"/g, "%22")}")` : "";
  $("welcomeTitle").textContent = "Welcome, " + name.split(" ")[0];
}
function showProfile(p){
  if (!p || !p.since) return;
  const d = new Date(p.since);
  $("accountSince").textContent = "Member since " + MONL[d.getMonth()] + " " + d.getFullYear();
  $("accountSince").hidden = false;
}
function toggleMenu(open){ $("accountMenu").hidden = !open; $("accountBtn").setAttribute("aria-expanded", open); }
$("accountBtn").addEventListener("click", ev => { ev.stopPropagation(); toggleMenu($("accountMenu").hidden); });
document.addEventListener("click", ev => { if (!ev.target.closest(".account")) toggleMenu(false); });
document.addEventListener("keydown", ev => { if (ev.key === "Escape") toggleMenu(false); });
$("signOutBtn").addEventListener("click", async () => { toggleMenu(false); clearOffline(); await signOut(); });
$("welcomeAdd").addEventListener("click", () => openSheet());

/* ---------- offline copy ---------- */
// The last loaded log is kept on the device so the installed app can show it
// without a connection. Changes still need a connection to save.
const CACHE_KEY = "fuel-offline-v1";
function saveOffline(user){
  try{ localStorage.setItem(CACHE_KEY, JSON.stringify({user: {id: user.id, email: user.email, user_metadata: user.user_metadata}, entries, settings, prices, rules, svcLog, at: Date.now()})); }catch(e){}
}
function readOffline(userId){
  try{ const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); return c && (!userId || c.user.id === userId) ? c : null; }catch(e){ return null; }
}
function clearOffline(){ try{ localStorage.removeItem(CACHE_KEY); }catch(e){} }
function showOffline(c){
  entries = c.entries || []; prices = c.prices || []; rules = c.rules ?? null; svcLog = c.svcLog || []; Object.assign(settings, c.settings || {});
  loaded = true; render();
  const d = new Date(c.at);
  status("You're offline. Showing your log as of " + d.getDate() + " " + MON[d.getMonth()] + ", " + d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) + ". Changes need a connection.");
}
window.addEventListener("online", () => { if (currentUserId && store) reloadLog(); else if (currentUserId) location.reload(); });

/* ---------- install ---------- */
let installPrompt = null;
window.addEventListener("beforeinstallprompt", ev => { ev.preventDefault(); installPrompt = ev; $("installBtn").hidden = false; });
window.addEventListener("appinstalled", () => { installPrompt = null; $("installBtn").hidden = true; toast("Fuel Logbook installed"); });
$("installBtn").addEventListener("click", async () => {
  toggleMenu(false);
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null; $("installBtn").hidden = true;
});
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
$("iosHint").hidden = !(isIOS && !isStandalone);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

/* ---------- init ---------- */
fillCurrencySelect();
let currentUserId = null, currentUser = null;
async function reloadLog(){
  try{
    const [rows, saved, pr, rl, sl] = await Promise.all([store.listEntries(), store.getSettings(), store.listPrices(), store.listServiceRules(), store.listServiceLog()]);
    prices = pr; rules = rl; svcLog = sl || [];
    entries = rows;
    if (saved) Object.assign(settings, saved);
    loaded = true; status(""); render();
    saveOffline(currentUser);
    return true;
  }catch(e){
    const c = readOffline(currentUserId);
    if (c) showOffline(c);
    else { loaded = true; render(); status("Couldn't load your log. Check your connection and reload the page."); }
    return false;
  }
}
async function enterApp(user){
  if (currentUserId === user.id) return;
  currentUserId = user.id; currentUser = user;
  renderAccount(user);
  showScreen("app");
  loaded = false; entries = []; render();
  store = await openStore(user);
  // The profile isn't needed to use the log, so a missing one never blocks loading.
  store.touchProfile().then(showProfile, () => {});
  await reloadLog();
  // Home-screen shortcut "Add fill-up" opens the app at #add.
  if (location.hash === "#add"){ history.replaceState(null, "", location.pathname); openSheet(); }
}
function leaveApp(){
  currentUserId = null; currentUser = null; store = null; entries = []; loaded = false; rules = null; svcLog = [];
  $("accountSince").hidden = true;
  settings = {currency:"PKR", gallon:"US", odoUnit:"km", cardLiters:0, cardAmount:0, cardType:"liters"};
  if (sheet.open) closeSheet();
  $("googleSignIn").disabled = false;
  showScreen("signin");
}

async function start(){
  if (!cloudConfigured){
    leaveApp();
    $("googleSignIn").disabled = true;
    showSigninError("This app isn't connected to its database yet. Add the Supabase Project URL and anon key to js/config.js.");
    return;
  }
  // Google sends people back with ?error_description=… when sign-in is cancelled or refused.
  const params = new URLSearchParams(location.search + "&" + location.hash.slice(1));
  const oauthError = params.get("error_description");
  if (oauthError) history.replaceState(null, "", location.pathname);
  try{
    const user = await getUser();
    if (user) await enterApp(user); else { leaveApp(); if (oauthError) showSigninError("Sign-in didn't finish: " + oauthError); }
    await onAuthChange((event, u) => { if (u) enterApp(u); else if (event === "SIGNED_OUT") leaveApp(); });
  }catch(e){
    // Offline launch of the installed app: show the last saved log.
    const c = readOffline();
    if (c){ currentUserId = c.user.id; currentUser = c.user; renderAccount(c.user); showScreen("app"); showOffline(c); return; }
    leaveApp();
    showSigninError("Couldn't reach the server. Check your connection and reload the page.");
  }
}
start();
