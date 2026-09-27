import { cloudConfigured, getUser, signInWithGoogle, signOut, onAuthChange, openStore } from "./cloud.js";

const KM_PER_MI = 1.609344, GAL = {US:3.785411784, UK:4.54609};
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
let entries = [], settings = {currency:"PKR", gallon:"US", odoUnit:"km"};
let ui = {dist:"km", vol:"L", per:"month", f:"all", tab:"overview"};
try{ Object.assign(ui, JSON.parse(localStorage.getItem("fuel-ui2") || "{}")); }catch(e){}
function saveUi(){ try{ localStorage.setItem("fuel-ui2", JSON.stringify(ui)); }catch(e){} }

let store = null, loaded = false, editingId = null, payer = "self", lastPriceEdit = "paid";
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
  if (ui.tab === "reports"){ renderSpendChart(list); renderBreakdown(list, segs); }
}

function renderOverview(C, fills){
  const {list, segs, segById, overall} = C;
  // A brand-new account sees a welcome card instead of empty gauges.
  const fresh = loaded && !list.length;
  $("welcome").hidden = !fresh;
  document.querySelectorAll(".dash").forEach(el => el.hidden = fresh);
  if (fresh) return;
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
  $("sDistS").textContent = fmt(vOut(overall.lit), 1) + " " + vU() + " of fuel";

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
      <div class="legend"><span>Card <b style="color:var(--card)">${money(s.card)}</b></span><span>Me <b style="color:var(--me)">${money(s.self)}</b></span></div>
      <span class="muted" style="font-size:12.5px">${esc(sub)} · ${fl.length} fill-ups · ${fmt(vOut(vol),1)} ${vU()}</span>
    </div>`;
  }).join("");

  renderChart(segs, overall.e);
  renderCalendar(C);
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
    : `${e.partial ? '<span class="chip part">Partial</span>' : ""}<button class="chip ${isCard(e) ? "card" : "self"}" data-toggle="${esc(e.id)}" title="Switch who paid">${isCard(e) ? "Fuel card" : "Me"}</button>` +
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

  const fl = C.list.filter(e => monthKey(e.date) === calMonth && e.liters > 0);
  const ma = agg(C.segs.filter(s => monthKey(s.date) === calMonth));
  $("calSum").innerHTML = fl.length
    ? `<span><b>${fl.length}</b> fill-ups</span><span><b>${fmt(vOut(sum(fl, e => e.liters)),1)}</b> ${vU()}</span>` +
      `<span><b>${fmt(ma.e)}</b> ${econUnit()} average</span><span><b>${money(sum(fl, e => e.paid > 0 ? e.paid : 0))}</b> spent</span>`
    : `<span>No fill-ups in ${MONL[m-1]} ${y}.</span>`;

  const lead = (new Date(y, m-1, 1).getDay() + 6) % 7, days = new Date(y, m, 0).getDate();
  let h = WEEKDAYS.map(d => `<div class="cal-wd" role="columnheader">${d}</div>`).join("");
  for (let i = 0; i < lead; i++) h += `<div class="cal-pad" aria-hidden="true"></div>`;
  for (let d = 1; d <= days; d++){
    const ds = calMonth + "-" + String(d).padStart(2,"0"), es = byDay[ds] || [];
    const cls = ["cal-d"];
    if (ds === today) cls.push("today");
    if (ds === calSel) cls.push("sel");
    if (es.length) cls.push("has");
    if (ds > today) cls.push("future");
    const marks = es.slice(0, 2).map(e => {
      if (!(e.liters > 0)) return `<span class="cal-m read">Reading</span>`;
      const s = C.segById[e.id], ev = s ? econ(s.dist, s.lit) : null;
      return `<span class="cal-m ${rating(ev, C.overall.e)}"><i class="dot" style="background:var(--${isCard(e) ? "card" : "me"})"></i>` +
        `<span class="cal-v">${fmt(vOut(e.liters),1)} ${vU()}</span>${ev != null ? `<b>${fmt(ev)}</b>` : ""}</span>`;
    }).join("") + (es.length > 2 ? `<span class="cal-more">+${es.length - 2} more</span>` : "");
    const label = longDate(ds) + (es.length ? ", " + es.length + (es.length > 1 ? " entries" : " entry") : "");
    h += `<button type="button" class="${cls.join(" ")}" data-day="${ds}" aria-label="${label}" aria-pressed="${ds === calSel}"><span class="cal-n">${d}</span>${marks}</button>`;
  }
  $("cal").innerHTML = h;

  // Entries for the selected day, with edit / price / payer controls from the log.
  const box = $("calDay");
  box.hidden = !calSel || monthKey(calSel) !== calMonth;
  if (box.hidden) return;
  const es = byDay[calSel] || [];
  box.innerHTML = `<div class="calday-h"><h3>${longDate(calSel)}</h3><button class="btn ghost" type="button" data-addon="${calSel}">＋ Add fill-up on this day</button></div>` +
    (es.length ? `<div class="list">${es.slice().reverse().map(e => entryRow(e, C)).join("")}</div>` : `<p class="empty">No fill-ups on this day.</p>`);
}
$("cal").addEventListener("click", ev => {
  const b = ev.target.closest("[data-day]"); if (!b) return;
  calSel = calSel === b.dataset.day ? null : b.dataset.day; render();
});
$("calPrev").addEventListener("click", () => { calMonth = shiftMonth(calMonth, -1); render(); });
$("calNext").addEventListener("click", () => { calMonth = shiftMonth(calMonth, 1); render(); });
$("calToday").addEventListener("click", () => { calMonth = monthKey(todayIso()); calSel = null; render(); });

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
  $("brk").innerHTML = `<thead><tr><th>${ui.per === "week" ? "Week" : "Month"}</th><th class="num">Fill-ups</th><th class="num">Fuel</th><th class="num">Distance</th><th class="num">Average</th><th class="num">Fuel card</th><th class="num">Me</th><th class="num">Total</th></tr></thead><tbody>` +
    keys.map(k => { const r = g[k];
      return `<tr><td>${label(k)}</td><td class="num">${r.fills}</td><td class="num">${fmt(vOut(r.fuel),1)} ${vU()}</td>
        <td class="num">${r.dist ? fmt(dOut(r.dist),0) + " " + dU() : "–"}</td>
        <td class="num">${r.lit ? "<b>" + fmt(econ(r.dist, r.lit)) + '</b> <span class="muted">' + econUnit() + "</span>" : "–"}</td>
        <td class="num" style="color:var(--card)">${money(r.card)}</td><td class="num" style="color:var(--me)">${money(r.self)}</td><td class="num"><b>${money(r.card + r.self)}</b></td></tr>`; }).join("") + "</tbody>";
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
function upsertLocal(row){ const i = entries.findIndex(e => e.id === row.id); if (i >= 0) entries[i] = row; else entries.push(row); render(); }
// Adds when id is null; re-creates a deleted entry when restoring (undo).
async function writeEntry(id, body, restoring){
  const row = id && !restoring ? await store.updateEntry(id, body) : await store.addEntry(body, id);
  upsertLocal(row);
}
async function patchEntry(id, patch){
  const e = entries.find(x => x.id === id); if (!e) return;
  await store.setPayer(id, patch.payer);
  Object.assign(e, patch); render();
}
async function removeEntry(id){
  await store.deleteEntry(id);
  entries = entries.filter(e => e.id !== id); render();
}
let settingsTimer = null;
function saveSettings(){
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    try{ await store.saveSettings(settings); }catch(e){ toast("Couldn't save settings. Try again."); }
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
    $("sheetTitle").textContent = "Add fill-up"; $("fDate").value = date || todayIso(); setPayer(last && last.liters > 0 && isCard(last) ? "card" : "self");
    $("fSubmit").textContent = "Add fill-up"; $("fDelete").hidden = true;
  }
  lastPriceEdit = "paid";
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
$("fPaid").addEventListener("input", () => { lastPriceEdit = "paid"; syncPrice(); });
$("fPpu").addEventListener("input", () => { lastPriceEdit = "ppu"; syncPrice(); });
["fOdo","fDate","fVol"].forEach(id => $(id).addEventListener("input", () => { if (id === "fVol") syncPrice(); updatePreview(); }));
$("fPartial").addEventListener("change", updatePreview);
document.querySelectorAll(".payer button").forEach(b => b.addEventListener("click", () => setPayer(b.dataset.p)));

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
$("signOutBtn").addEventListener("click", async () => { toggleMenu(false); await signOut(); });
$("welcomeAdd").addEventListener("click", () => openSheet());

/* ---------- init ---------- */
fillCurrencySelect();
let currentUserId = null;
async function enterApp(user){
  if (currentUserId === user.id) return;
  currentUserId = user.id;
  renderAccount(user);
  showScreen("app");
  loaded = false; entries = []; render();
  try{
    store = await openStore(user);
    // The profile isn't needed to use the log, so a missing one never blocks loading.
    store.touchProfile().then(showProfile, () => {});
    const [rows, saved] = await Promise.all([store.listEntries(), store.getSettings()]);
    entries = rows;
    if (saved) Object.assign(settings, saved);
    loaded = true; status(""); render();
  }catch(e){
    loaded = true; render();
    status("Couldn't load your log. Check your connection and reload the page.");
  }
}
function leaveApp(){
  currentUserId = null; store = null; entries = []; loaded = false;
  $("accountSince").hidden = true;
  settings = {currency:"PKR", gallon:"US", odoUnit:"km"};
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
    leaveApp();
    showSigninError("Couldn't reach the server. Check your connection and reload the page.");
  }
}
start();
