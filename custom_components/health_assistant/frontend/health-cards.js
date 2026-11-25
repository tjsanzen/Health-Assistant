/* Health Assistant — dashboard cards.
 *
 *   type: custom:health-assistant-lift-calendar   → month calendar, lifting days circled in green
 *   type: custom:health-assistant-calorie-gauge   → today's calories as a speedometer
 *   type: custom:health-assistant-log-meal        → button that opens a "log a meal" dialog
 *   type: custom:health-assistant-nutrition-today → calorie ring + macro bars for today
 *   type: custom:health-assistant-nutrition-averages → 7-day / 30-day / all-time averages
 *   type: custom:health-assistant-calorie-history → last 14 days of calories (show_fat_burned, show_streak)
 *   type: custom:health-assistant-exercise-progress → one exercise over time
 *       exercise_name: bench_press    (id or name; the closest match is used)
 *       time: 30                      (days, or all_time — the default)
 *       metric: e1rm                  (optional: e1rm, weight, volume, reps, duration_s, distance_m)
 *
 * Optional on every card:  profile: Anna   (profile name or id; default = your linked profile)
 * Loaded automatically on every dashboard by the integration — no resource to add.
 */
(() => {
const DOMAIN = "health_assistant";
const OZ_G = 28.349523125;
const MEALS = ["breakfast", "lunch", "dinner", "snack"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r0 = (n) => (n == null || isNaN(n) ? "–" : Math.round(n).toLocaleString());
const r1 = (n) => (n == null || isNaN(n) ? "–" : (Math.round(n * 10) / 10).toLocaleString());
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n) => String(n).padStart(2, "0");
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* Same portion maths as the Health panel. */
function portion(food, amount, unit) {
  amount = Number(amount) || 0;
  const keys = ["kcal", "protein", "fat", "carbs", "fiber"];
  const out = { grams: null };
  if (food.per_100g) {
    const sg = food.serving_g || 100;
    const grams = unit === "g" ? amount : unit === "oz" ? amount * OZ_G : amount * sg;
    out.grams = Math.round(grams * 10) / 10;
    keys.forEach((k) => (out[k] = ((food.per_100g[k] || 0) * grams) / 100));
  } else if (food.per_serving) {
    let servings = amount;
    if (unit === "g" && food.serving_g) servings = amount / food.serving_g;
    if (unit === "oz" && food.serving_g) servings = (amount * OZ_G) / food.serving_g;
    if (food.serving_g) out.grams = Math.round(servings * food.serving_g * 10) / 10;
    keys.forEach((k) => (out[k] = (food.per_serving[k] || 0) * servings));
  }
  keys.forEach((k) => (out[k] = Math.round((out[k] || 0) * 10) / 10));
  return out;
}
function servingLabel(food) {
  const parts = [];
  if (food.serving_qty && food.serving_unit) parts.push(`${r1(food.serving_qty)} ${food.serving_unit}`);
  if (food.serving_g && food.serving_unit !== "g") parts.push(`${r0(food.serving_g)} g`);
  if (!parts.length) return food.per_100g ? "100 g" : "serving";
  return parts.join(" · ");
}
function mealForNow() {
  const h = new Date().getHours();
  return h < 10 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snack";
}

const BASE_CSS = `
  :host { --hc-accent: var(--primary-color, #03a9f4); --hc-muted: var(--secondary-text-color, #727272);
    --hc-line: var(--divider-color, rgba(0,0,0,.12)); --hc-fill: color-mix(in srgb, var(--primary-text-color, #000) 6%, transparent); }
  * { box-sizing: border-box; }
  ha-card { display: block; height: 100%; }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
  .muted { color: var(--hc-muted); }
  .err { color: var(--error-color, #db4437); font-size: .85rem; padding: 8px 0; }
`;

/* Base class: resolves the profile once, exposes ws(). */
class HACard extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); }
  setConfig(config) { this._config = config || {}; this._profileId = undefined; this._loaded = false; }
  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (first) this._start();
    this.hassChanged?.(h);
  }
  connectedCallback() { if (this._hass && !this._timer) this._start(); }
  disconnectedCallback() { clearInterval(this._timer); this._timer = null; }
  _start() {
    this.refresh();
    clearInterval(this._timer);
    if (this.refreshEvery) this._timer = setInterval(() => this.refresh(), this.refreshEvery);
  }
  async ws(cmd, data = {}) {
    if (this._profileId === undefined) {
      this._profileId = null;
      const want = this._config.profile;
      if (want) {
        const profiles = await this._hass.callWS({ type: `${DOMAIN}/profiles` });
        const p = profiles.find((x) => x.id === want || (x.name || "").toLowerCase() === String(want).toLowerCase());
        if (!p) throw new Error(`No Health Assistant profile called "${want}"`);
        this._profileId = p.id;
      }
    }
    const msg = { type: `${DOMAIN}/${cmd}`, ...data };
    if (this._profileId) msg.profile_id = this._profileId;
    return this._hass.callWS(msg);
  }
}

/* ======================================================= lifting calendar */
class LiftCalendarCard extends HACard {
  static getStubConfig() { return {}; }
  get refreshEvery() { return 5 * 60 * 1000; }
  getCardSize() { return 6; }
  getGridOptions() { return { columns: 6, rows: 6, min_columns: 4, min_rows: 5 }; }
  setConfig(config) {
    super.setConfig(config);
    const now = new Date();
    this._y = now.getFullYear(); this._m = now.getMonth() + 1;
  }

  async refresh() {
    try {
      this._days = await this.ws("workout/calendar", { year: this._y, month: this._m });
      this._error = null;
    } catch (e) { this._error = e.message || String(e); }
    this.render();
  }

  render() {
    const y = this._y, m = this._m;
    const first = new Date(y, m - 1, 1);
    const daysIn = new Date(y, m, 0).getDate();
    const lifts = Object.fromEntries((this._days || []).map((d) => [d.date, d]));
    const today = localDate();
    const weekdays = [...Array(7)].map((_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));
    let cells = "";
    for (let i = 0; i < first.getDay(); i++) cells += `<span></span>`;
    for (let d = 1; d <= daysIn; d++) {
      const iso = `${y}-${pad(m)}-${pad(d)}`;
      const l = lifts[iso];
      const title = l ? `${l.names.join(", ")}` : "";
      cells += `<span class="day ${l ? "lift" : ""} ${iso === today ? "today" : ""}" title="${esc(title)}">${d}</span>`;
    }
    const count = (this._days || []).reduce((a, d) => a + d.count, 0);
    const title = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}
        ha-card { padding: 12px 14px 14px; }
        .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
        .head b { font-size:1.05rem; }
        .nav { width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; }
        .nav:hover { background: var(--hc-fill); }
        .grid { display:grid; grid-template-columns:repeat(7,1fr); gap:4px; text-align:center; }
        .wd { font-size:.72rem; color: var(--hc-muted); font-weight:600; padding:2px 0; }
        .day { aspect-ratio:1; display:flex; align-items:center; justify-content:center; border-radius:50%; font-size:.9rem; font-variant-numeric:tabular-nums; max-width:40px; margin:auto; width:100%; }
        .day.lift { background:#34c759; color:#fff; font-weight:700; }
        .day.today { box-shadow: inset 0 0 0 2px var(--hc-accent); }
        .day.lift.today { box-shadow: inset 0 0 0 2px #fff, 0 0 0 2px #34c759; }
        .foot { margin-top:8px; font-size:.82rem; }
      </style>
      <ha-card>
        <div class="head">
          <button class="nav" data-d="-1" aria-label="Previous month"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
          <b>${esc(this._config.title || title)}</b>
          <button class="nav" data-d="1" aria-label="Next month"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
        </div>
        ${this._config.title ? `<div class="muted" style="text-align:center;margin:-4px 0 6px;font-size:.85rem">${esc(title)}</div>` : ""}
        <div class="grid">${weekdays.map((w) => `<span class="wd">${w}</span>`).join("")}${cells}</div>
        ${this._error ? `<div class="err">${esc(this._error)}</div>` : `<div class="foot muted">${count} workout${count === 1 ? "" : "s"} this month</div>`}
      </ha-card>`;
    this.shadowRoot.querySelectorAll(".nav").forEach((b) => b.addEventListener("click", () => {
      this._m += Number(b.dataset.d);
      if (this._m < 1) { this._m = 12; this._y--; } else if (this._m > 12) { this._m = 1; this._y++; }
      this.refresh();
    }));
  }
}

/* ===================================================== calorie speedometer */
class CalorieGaugeCard extends HACard {
  static getStubConfig() { return {}; }
  get refreshEvery() { return 60 * 1000; }
  getCardSize() { return 4; }
  getGridOptions() { return { columns: 6, rows: 4, min_columns: 4, min_rows: 3 }; }

  hassChanged(h) {
    // Refresh straight away when the "Calories today" sensor changes (e.g. food logged elsewhere).
    if (!this._watch) this._watch = Object.keys(h.states).filter((id) => id.startsWith("sensor.") && id.endsWith("_calories_today"));
    const sig = this._watch.map((id) => h.states[id]?.state).join("|");
    if (this._sig !== undefined && sig !== this._sig) this.refresh();
    this._sig = sig;
  }

  async refresh() {
    try { this._day = await this.ws("food/day", { date: localDate() }); this._error = null; }
    catch (e) { this._error = e.message || String(e); }
    this.render();
  }

  render() {
    const d = this._day;
    const eaten = d?.totals?.kcal || 0;
    const target = d?.target || 0;
    const max = Math.max(target * 1.3, eaten * 1.05, 1);
    // Semicircle from 180° (left) to 0° (right).
    const cx = 120, cy = 120, R = 96;
    const ang = (v) => Math.PI * (1 - Math.min(v, max) / max);
    const pt = (v, r = R) => [cx + r * Math.cos(ang(v)), cy - r * Math.sin(ang(v))];
    const arc = (a, b, cls) => {
      const [x1, y1] = pt(a), [x2, y2] = pt(b);
      return `<path class="${cls}" d="M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}"/>`;
    };
    const zones = target
      ? arc(0, target * 0.9, "z1") + arc(target * 0.9, target * 1.1, "z2") + arc(target * 1.1, max, "z3")
      : arc(0, max, "z1");
    const [nx, ny] = pt(eaten, R - 18);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const v = f * max, [x1, y1] = pt(v, R + 10), [x2, y2] = pt(v, R + 4);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="tick"/>`;
    }).join("");
    const left = target - eaten;
    const status = !target ? "" : left >= 0 ? `${r0(left)} kcal left` : `${r0(-left)} kcal over`;
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}
        ha-card { padding: 12px 14px 10px; text-align:center; }
        .title { text-align:left; font-weight:600; margin-bottom:2px; }
        svg { width:100%; max-width:320px; display:block; margin:0 auto; }
        path { fill:none; stroke-width:16; }
        .z1 { stroke: color-mix(in srgb, var(--hc-accent) 75%, transparent); }
        .z2 { stroke: #34c759; } .z3 { stroke: #ff3b30; }
        .tick { stroke: var(--hc-muted); stroke-width:2; }
        .needle { stroke: var(--primary-text-color, #222); stroke-width:4; stroke-linecap:round; transition: all .6s; }
        .hub { fill: var(--primary-text-color, #222); }
        .val { font-size:30px; font-weight:700; fill: var(--primary-text-color, #222); font-variant-numeric:tabular-nums; }
        .sub { font-size:12px; fill: var(--hc-muted); }
        .status { font-weight:600; margin-top:2px; } .over { color:#ff3b30; }
      </style>
      <ha-card>
        <div class="title">${esc(this._config.title || "Calories today")}</div>
        <svg viewBox="0 0 240 172" role="img" aria-label="${r0(eaten)} of ${r0(target)} calories">
          ${zones}${ticks}
          <line class="needle" x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}"/>
          <circle class="hub" cx="${cx}" cy="${cy}" r="6"/>
          <text class="val" x="${cx}" y="${cy + 32}" text-anchor="middle">${r0(eaten)}</text>
          <text class="sub" x="${cx}" y="${cy + 49}" text-anchor="middle">${target ? `of ${r0(target)} kcal` : "kcal"}</text>
        </svg>
        ${this._error ? `<div class="err">${esc(this._error)}</div>` : `<div class="status ${left < 0 ? "over" : ""}">${status}</div>`}
      </ha-card>`;
  }
}

/* ======================================================== log-meal button */
class LogMealCard extends HACard {
  static getStubConfig() { return { name: "Log meal" }; }
  getCardSize() { return 1; }
  getGridOptions() { return { columns: 6, rows: 1, min_columns: 3, min_rows: 1 }; }
  refresh() { this.render(); }
  render() {
    if (this.shadowRoot.querySelector("ha-card")) return;
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}
        ha-card { height:100%; }
        button { width:100%; height:100%; min-height:56px; display:flex; align-items:center; justify-content:center; gap:10px;
          font-weight:600; font-size:1rem; padding:12px; border-radius: var(--ha-card-border-radius, 12px); color: var(--hc-accent); }
        button:hover { background: var(--hc-fill); }
        ha-icon { --mdc-icon-size: 26px; }
      </style>
      <ha-card><button><ha-icon icon="${esc(this._config.icon || "mdi:silverware-fork-knife")}"></ha-icon>${esc(this._config.name || "Log meal")}</button></ha-card>`;
    this.shadowRoot.querySelector("button").addEventListener("click", () => this.openDialog());
  }
  openDialog() {
    const dlg = document.createElement("health-assistant-log-meal-dialog");
    dlg.card = this;
    document.body.appendChild(dlg);
  }
  notify(message) {
    this.dispatchEvent(new CustomEvent("hass-notification", { detail: { message }, bubbles: true, composed: true }));
  }
}

/* The dialog lives on <body> so dashboard layouts can't clip it. */
class LogMealDialog extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.s = { meal: mealForNow(), mode: "search", query: "", results: null, recent: [], custom: [], food: null, amount: 1, unit: "serving" };
  }
  connectedCallback() {
    this._narrow = window.innerWidth < 600;
    this.render();
    this.card.ws("food/recent").then((r) => { Object.assign(this.s, r); if (!this.s.query && !this.s.food) this.renderBody(); }).catch(() => {});
    this._key = (e) => { if (e.key === "Escape") this.close(); };
    window.addEventListener("keydown", this._key);
  }
  disconnectedCallback() { window.removeEventListener("keydown", this._key); }
  close() { this.remove(); }

  render() {
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}
        :host { position:fixed; inset:0; z-index:9999; font: 15px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--primary-text-color, #212121); }
        .scrim { position:absolute; inset:0; background:rgba(0,0,0,.4); }
        .dlg { position:absolute; background: var(--card-background-color, #fff); display:flex; flex-direction:column; box-shadow:0 10px 40px rgba(0,0,0,.25); }
        .dlg.sheet { left:0; right:0; bottom:0; max-height:88vh; border-radius:16px 16px 0 0; padding-bottom: env(safe-area-inset-bottom); animation: up .25s ease-out; }
        .dlg.modal { left:50%; top:50%; transform:translate(-50%,-50%); width:min(520px,94vw); max-height:84vh; border-radius:16px; }
        @keyframes up { from { transform: translateY(100%); } }
        .hd { display:flex; align-items:center; justify-content:space-between; padding:14px 16px 6px; }
        .hd h2 { margin:0; font-size:1.2rem; }
        .x { width:32px; height:32px; border-radius:50%; background: var(--hc-fill); display:flex; align-items:center; justify-content:center; }
        .x ha-icon { --mdc-icon-size:18px; }
        .bd { overflow-y:auto; padding: 4px 16px 16px; }
        .seg { display:flex; background: var(--hc-fill); border-radius:10px; padding:2px; margin:6px 0 10px; }
        .seg button { flex:1; padding:7px 4px; border-radius:8px; font-weight:500; font-size:.88rem; }
        .seg button.on { background: var(--card-background-color, #fff); box-shadow:0 1px 3px rgba(0,0,0,.12); font-weight:600; }
        input, select { font:inherit; font-size:16px; color:inherit; background: var(--hc-fill); border:1px solid transparent; border-radius:10px; padding:10px 12px; width:100%; }
        input:focus, select:focus { outline:none; border-color: var(--hc-accent); }
        .row { display:flex; width:100%; justify-content:space-between; align-items:center; gap:10px; text-align:left; padding:10px 2px; border-top:1px solid var(--hc-line); }
        .row .k { font-weight:600; white-space:nowrap; }
        h3 { font-size:.95rem; margin:12px 0 4px; }
        .portion { display:flex; gap:8px; margin:12px 0; } .portion input { width:100px; flex:0 0 auto; text-align:center; font-weight:600; }
        .nutri { display:grid; grid-template-columns:repeat(4,1fr); text-align:center; background: var(--hc-fill); border-radius:12px; padding:10px 4px; }
        .nutri b { display:block; font-size:1.15rem; }
        .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        label { display:flex; flex-direction:column; gap:4px; font-size:.82rem; color: var(--hc-muted); }
        .btn { width:100%; margin-top:12px; padding:12px; border-radius:12px; background: var(--hc-accent); color: var(--text-primary-color, #fff); font-weight:600; }
        .link { color: var(--hc-accent); font-weight:600; padding:6px 0; }
        .attr { text-align:center; font-size:.72rem; color: var(--hc-muted); margin-top:14px; } .attr a { color:inherit; }
        .center { text-align:center; }
      </style>
      <div class="scrim"></div>
      <div class="dlg ${this._narrow ? "sheet" : "modal"}" role="dialog" aria-modal="true">
        <div class="hd"><h2>Log a meal</h2><button class="x" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="bd" id="bd"></div>
      </div>`;
    this.shadowRoot.querySelector(".scrim").addEventListener("click", () => this.close());
    this.shadowRoot.querySelector(".x").addEventListener("click", () => this.close());
    const bd = this.shadowRoot.getElementById("bd");
    bd.addEventListener("click", (e) => this.onClick(e));
    bd.addEventListener("input", (e) => this.onInput(e));
    bd.addEventListener("change", (e) => this.onChange(e));
    this.renderBody();
  }

  renderBody() {
    const s = this.s, bd = this.shadowRoot.getElementById("bd");
    const meals = `<div class="seg">${MEALS.map((m) => `<button class="${s.meal === m ? "on" : ""}" data-meal="${m}">${cap(m)}</button>`).join("")}</div>`;
    const attr = `<div class="attr">Data Source: <a href="https://www.opennutrition.app" target="_blank" rel="noopener noreferrer">OpenNutrition</a></div>`;
    if (s.food) {
      const f = s.food, p = portion(f, s.amount, s.unit);
      const units = [["serving", `serving (${servingLabel(f)})`]];
      if (f.per_100g || f.serving_g) units.push(["g", "grams"], ["oz", "ounces"]);
      bd.innerHTML = `${meals}<button class="link" data-act="back">‹ Back</button>
        <h3>${esc(f.name)}${f.brand ? ` <span class="muted">${esc(f.brand)}</span>` : ""}</h3>
        <div class="portion"><input id="amt" inputmode="decimal" value="${s.amount}" aria-label="Amount">
          <select id="unit">${units.map(([v, l]) => `<option value="${v}" ${s.unit === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <div class="nutri" id="nutri">${this.nutri(p)}</div>
        <button class="btn" data-act="add">Add to ${cap(s.meal)}</button>${attr}`;
      return;
    }
    const tabs = `<div class="seg"><button class="${s.mode === "search" ? "on" : ""}" data-mode="search">Search</button><button class="${s.mode === "quick" ? "on" : ""}" data-mode="quick">Quick add</button></div>`;
    if (s.mode === "quick") {
      bd.innerHTML = `${meals}${tabs}<label>Name<input data-q="name" value="Quick add"></label>
        <div class="grid2" style="margin-top:10px"><label>Calories<input data-q="kcal" inputmode="decimal"></label><label>Protein (g)<input data-q="protein" inputmode="decimal"></label>
        <label>Carbs (g)<input data-q="carbs" inputmode="decimal"></label><label>Fat (g)<input data-q="fat" inputmode="decimal"></label>
        <label>Fiber (g)<input data-q="fiber" inputmode="decimal"></label></div>
        <button class="btn" data-act="quick">Add to ${cap(s.meal)}</button>`;
      return;
    }
    bd.innerHTML = `${meals}${tabs}<input id="q" type="search" placeholder="Search OpenNutrition Database" value="${esc(s.query)}" autocomplete="off" enterkeyhint="search">
      <div id="res">${this.results()}</div>${attr}`;
    if (!this._narrow) this.shadowRoot.getElementById("q").focus();
  }

  results() {
    const s = this.s;
    const row = (f, src, i) => `<button class="row" data-pick="${src}" data-i="${i}"><span><span>${esc(f.name)}</span>${f.brand ? ` <span class="muted">${esc(f.brand)}</span>` : ""}<br><span class="muted" style="font-size:.82rem">${esc(servingLabel(f))}</span></span><span class="k">${r0(portion(f, 1, "serving").kcal)}</span></button>`;
    if (!s.query) {
      if (!s.recent.length && !s.custom.length) return `<p class="muted center">Search 300,000+ foods.</p>`;
      return (s.recent.length ? `<h3>Recent</h3>${s.recent.map((f, i) => row(f, "recent", i)).join("")}` : "")
        + (s.custom.length ? `<h3>My foods</h3>${s.custom.map((f, i) => row(f, "custom", i)).join("")}` : "");
    }
    if (!s.results) return `<p class="muted center">Searching…</p>`;
    const r = s.results;
    if (!r.custom.length && !r.results.length) return `<p class="muted center">No matches.</p>`;
    return r.custom.map((f, i) => row(f, "rcustom", i)).join("") + r.results.map((f, i) => row(f, "results", i)).join("");
  }
  nutri(p) {
    return `<div><b>${r0(p.kcal)}</b><span class="muted">kcal</span></div><div><b>${r1(p.protein)}</b><span class="muted">protein</span></div>
      <div><b>${r1(p.carbs)}</b><span class="muted">carbs</span></div><div><b>${r1(p.fat)}</b><span class="muted">fat</span></div>`;
  }

  onInput(e) {
    const s = this.s;
    if (e.target.id === "q") {
      s.query = e.target.value; s.results = null;
      clearTimeout(this._t);
      const res = () => (this.shadowRoot.getElementById("res").innerHTML = this.results());
      res();
      if (!s.query.trim()) return;
      this._t = setTimeout(async () => {
        const q = s.query;
        try { const r = await this.card.ws("food/search", { query: q, limit: 25 }); if (s.query === q) { s.results = r; res(); } }
        catch (err) { this.shadowRoot.getElementById("res").innerHTML = `<div class="err">${esc(err.message)}</div>`; }
      }, 250);
    } else if (e.target.id === "amt") {
      s.amount = e.target.value;
      this.shadowRoot.getElementById("nutri").innerHTML = this.nutri(portion(s.food, s.amount, s.unit));
    }
  }
  onChange(e) {
    const s = this.s;
    if (e.target.id === "unit") {
      const g = portion(s.food, s.amount, s.unit).grams;
      const v = e.target.value;
      if (g) s.amount = v === "g" ? Math.round(g) : v === "oz" ? Math.round((g / OZ_G) * 10) / 10 : Math.round((g / (s.food.serving_g || 100)) * 100) / 100;
      s.unit = v; this.renderBody();
    }
  }
  async onClick(e) {
    const s = this.s, b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    try {
      if (d.meal) { s.meal = d.meal; this.renderBody(); }
      else if (d.mode) { s.mode = d.mode; this.renderBody(); }
      else if (d.pick) {
        const pool = { recent: s.recent, custom: s.custom, rcustom: s.results?.custom, results: s.results?.results }[d.pick];
        const f = pool[+d.i];
        s.food = f;
        s.amount = d.pick === "recent" && f.last_amount ? f.last_amount : 1;
        s.unit = d.pick === "recent" && f.last_unit ? f.last_unit : "serving";
        this.renderBody();
      }
      else if (d.act === "back") { s.food = null; this.renderBody(); }
      else if (d.act === "add") {
        const f = s.food, p = portion(f, s.amount, s.unit);
        b.disabled = true;
        await this.card.ws("food/log", { entry: {
          date: localDate(), meal: s.meal, food_id: f.food_id || f.id, name: f.name, brand: f.brand,
          amount: Number(s.amount), unit: s.unit, ...p,
          per_100g: f.per_100g, per_serving: f.per_serving, serving_qty: f.serving_qty, serving_unit: f.serving_unit, serving_g: f.serving_g,
        } });
        this.card.notify(`Added ${f.name} to ${s.meal} (${r0(p.kcal)} kcal)`);
        this.close();
      }
      else if (d.act === "quick") {
        const get = (k) => { const v = this.shadowRoot.querySelector(`[data-q="${k}"]`).value; return v === "" ? 0 : Number(v); };
        if (!get("kcal") && !get("protein") && !get("carbs") && !get("fat")) return;
        b.disabled = true;
        await this.card.ws("food/log", { entry: { date: localDate(), meal: s.meal, name: this.shadowRoot.querySelector('[data-q="name"]').value || "Quick add",
          amount: 1, unit: "quick", kcal: get("kcal"), protein: get("protein"), carbs: get("carbs"), fat: get("fat"), fiber: get("fiber"), remember: false } });
        this.card.notify(`Added ${r0(get("kcal"))} kcal to ${s.meal}`);
        this.close();
      }
    } catch (err) {
      b.disabled = false;
      const bd = this.shadowRoot.getElementById("bd");
      bd.insertAdjacentHTML("beforeend", `<div class="err">${esc(err.message || err)}</div>`);
    }
  }
}

/* ==================================================== shared nutrition bits */
const LB = 2.20462262;
/** Refresh a card when the "Calories today" sensor changes (food logged anywhere). */
function watchCalories(card, h) {
  if (!card._watch) card._watch = Object.keys(h.states).filter((id) => id.startsWith("sensor.") && id.endsWith("_calories_today"));
  const sig = card._watch.map((id) => h.states[id]?.state).join("|");
  if (card._sig !== undefined && sig !== card._sig) card.refresh();
  card._sig = sig;
}
const NUTRI_CSS = `
  ha-card { padding: 12px 14px 14px; }
  .title { font-weight: 600; margin-bottom: 8px; }
  .big { font-size: 1.45rem; font-weight: 650; line-height: 1.15; font-variant-numeric: tabular-nums; }
  .big small { font-size: .85rem; font-weight: 400; color: var(--hc-muted); }
  .small { font-size: .85rem; } .xsmall { font-size: .75rem; }
  .row { display: flex; align-items: center; gap: 8px; } .between { justify-content: space-between; }
`;

/* ============================================ nutrition: calories + macros */
class NutritionTodayCard extends HACard {
  static getStubConfig() { return {}; }
  get refreshEvery() { return 60 * 1000; }
  getCardSize() { return 3; }
  getGridOptions() { return { columns: 6, rows: 3, min_columns: 6, min_rows: 2 }; }
  hassChanged(h) { watchCalories(this, h); }

  async refresh() {
    try { this._day = await this.ws("food/day", { date: localDate() }); this._error = null; }
    catch (e) { this._error = e.message || String(e); }
    this.render();
  }

  render() {
    const d = this._day || {};
    const t = d.totals || {}, mt = d.macro_targets || {};
    const target = d.target || 0, eaten = t.kcal || 0, left = target - eaten;
    const R = 52, C = 2 * Math.PI * R, pct = target ? Math.min(1, eaten / target) : 0;
    const macro = (k, label, color) => {
      const goal = mt[k] || 0, val = t[k] || 0;
      return `<div class="macro"><div class="row between small"><span>${label}</span><span class="muted">${r0(val)} / ${r0(goal)} g</span></div>
        <div class="bar"><div class="fill" style="background:${color};width:${goal ? Math.min(100, (val / goal) * 100) : 0}%"></div></div></div>`;
    };
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${NUTRI_CSS}
        .summary { display:flex; gap:16px; align-items:center; }
        .ringwrap { position:relative; width:118px; height:118px; flex:0 0 auto; }
        svg { width:100%; height:100%; }
        .ringbg { fill:none; stroke:var(--hc-fill); stroke-width:11; }
        .ringfg { fill:none; stroke:var(--hc-accent); stroke-width:11; stroke-linecap:round; transition:stroke-dashoffset .4s; } .ringfg.over { stroke:#ff3b30; }
        .ringtext { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
        .sumright { flex:1; display:flex; flex-direction:column; gap:5px; min-width:0; }
        .bar { height:7px; background:var(--hc-fill); border-radius:4px; overflow:hidden; margin:3px 0; }
        .fill { height:100%; border-radius:4px; transition:width .4s; }
      </style>
      <ha-card>
        ${this._config.title !== "" ? `<div class="title">${esc(this._config.title || "Today")}</div>` : ""}
        ${this._error ? `<div class="err">${esc(this._error)}</div>` : `<div class="summary">
          <div class="ringwrap"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${R}" class="ringbg"/>
            <circle cx="60" cy="60" r="${R}" class="ringfg ${target && eaten > target ? "over" : ""}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" transform="rotate(-90 60 60)"/></svg>
            <div class="ringtext"><div class="big">${r0(Math.abs(left))}</div><div class="muted small">${left >= 0 ? "kcal left" : "kcal over"}</div></div></div>
          <div class="sumright">
            <div class="row between small"><span>Eaten</span><b>${r0(eaten)}</b></div>
            <div class="row between small"><span>Target</span><b>${r0(target)}</b></div>
            ${macro("protein", "Protein", "#ff3b30")}${macro("carbs", "Carbs", "#ff9500")}${macro("fat", "Fat", "#af52de")}${macro("fiber", "Fiber", "#34c759")}
          </div></div>`}
      </ha-card>`;
  }
}

/* ======================================================= nutrition: averages */
class NutritionAveragesCard extends HACard {
  static getStubConfig() { return {}; }
  get refreshEvery() { return 10 * 60 * 1000; }
  getCardSize() { return 3; }
  getGridOptions() { return { columns: 6, rows: 3, min_columns: 6, min_rows: 3 }; }

  async refresh() {
    try { this._st = await this.ws("food/stats"); this._error = null; }
    catch (e) { this._error = e.message || String(e); }
    this.render();
  }

  render() {
    const st = this._st;
    const W = st ? [["d7", "7 days"], ["d30", "30 days"], ["all", `All (${st.all.days_logged}d)`]] : [];
    const row = (label, key, unit) => `<tr><th>${label}</th>${W.map(([k]) => { const v = st[k].avg[key]; return `<td>${v == null ? "–" : r0(v) + unit}</td>`; }).join("")}</tr>`;
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${NUTRI_CSS}
        table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
        th, td { padding:7px 4px; text-align:right; border-top:1px solid var(--hc-line); }
        thead th { border-top:0; font-size:.75rem; color:var(--hc-muted); font-weight:600; }
        tbody th { text-align:left; font-weight:500; } td { font-weight:600; }
      </style>
      <ha-card>
        <div class="title">${esc(this._config.title || "Averages")}</div>
        ${this._error ? `<div class="err">${esc(this._error)}</div>` : !st ? `<div class="muted small">Loading…</div>` : `
          <table><thead><tr><th></th>${W.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead>
          <tbody>${row("Calories", "kcal", "")}${row("Protein", "protein", " g")}${row("Carbs", "carbs", " g")}${row("Fat", "fat", " g")}${row("Fiber", "fiber", " g")}</tbody></table>
          <div class="muted xsmall" style="margin-top:6px">Averages use days you logged food, not counting today.</div>`}
      </ha-card>`;
  }
}

/* ============================================ nutrition: last 14 days chart */
class CalorieHistoryCard extends HACard {
  static getStubConfig() { return {}; }
  get refreshEvery() { return 5 * 60 * 1000; }
  getCardSize() { return 4; }
  getGridOptions() { return { columns: 6, rows: 4, min_columns: 6, min_rows: 3 }; }
  hassChanged(h) { watchCalories(this, h); }

  async refresh() {
    try { this._st = await this.ws("food/stats"); this._error = null; }
    catch (e) { this._error = e.message || String(e); }
    this.render();
  }

  render() {
    const st = this._st, cfg = this._config;
    let body = this._error ? `<div class="err">${esc(this._error)}</div>` : `<div class="muted small">Loading…</div>`;
    if (st && !this._error) {
      const max = Math.max(st.target || 0, st.maintenance || 0, ...st.series.map((d) => d.kcal), 1) * 1.08;
      const today = localDate();
      const bars = st.series.map((d) => {
        const overM = st.maintenance && d.kcal > st.maintenance;
        const over = !overM && st.target && d.kcal > st.target * 1.1;
        const dt = new Date(d.date + "T12:00:00");
        return `<div class="bcol" title="${dt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${r0(d.kcal)} kcal${overM ? " · over maintenance" : ""}"><div class="bbar ${overM ? "overm" : over ? "over" : ""} ${d.date === today ? "today" : ""}" style="height:${(d.kcal / max) * 100}%"></div><span>${"SMTWTFS"[dt.getDay()]}</span></div>`;
      }).join("");
      const lines = (st.target ? `<div class="tline" style="bottom:${(st.target / max) * 100}%"><span>Target ${r0(st.target)}</span></div>` : "")
        + (st.maintenance && Math.round(st.maintenance) !== Math.round(st.target || 0)
          ? `<div class="tline mline" style="bottom:${(st.maintenance / max) * 100}%"><span>Maintenance ${r0(st.maintenance)}</span></div>` : "");
      const legend = st.maintenance ? `<div class="blegend muted xsmall"><span><i class="sw"></i>Under target</span><span><i class="sw over"></i>Over target</span><span><i class="sw overm"></i>Over maintenance</span></div>` : "";
      const fw = st.fat_week;
      let fat = "";
      if (cfg.show_fat_burned !== false && fw?.show) {
        const imp = st.units !== "metric", f = (lb) => (imp ? lb : lb / LB), unit = imp ? "lb" : "kg";
        const val = fw.deficit_kcal <= 0 ? `0<small> ${unit}</small>` : `${f(fw.lb_low).toFixed(2)}–${f(fw.lb_high).toFixed(2)}<small> ${unit}</small>`;
        fat = `<div class="tile"><div class="muted small"><ha-icon icon="mdi:fire" style="--mdc-icon-size:16px;color:#ff9500;vertical-align:-3px"></ha-icon> Estimated fat burned this week</div><div class="big">${val}</div>
          <div class="muted xsmall">${fw.deficit_kcal > 0 ? `${r0(fw.deficit_kcal)} kcal under maintenance` : `${r0(-fw.deficit_kcal)} kcal over maintenance`} · last 7 days (${fw.days_logged} logged)</div></div>`;
      }
      const tiles = cfg.show_streak !== false ? `<div class="tiles">
          <div class="tile"><div class="muted small">Logging streak</div><div class="big">${st.streak}<small> day${st.streak === 1 ? "" : "s"}</small></div></div>
          <div class="tile"><div class="muted small">On target · 30 days</div><div class="big">${st.d30.on_target_days ?? "–"}<small> / ${st.d30.days_logged}</small></div><div class="muted xsmall">within ±10%</div></div></div>` : "";
      body = `<div class="bars"><div class="plot">${lines}${bars}</div></div>${legend}${fat}${tiles}`;
    }
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${NUTRI_CSS}
        .bars { padding-bottom:18px; margin-top:16px; }
        .plot { position:relative; display:flex; align-items:flex-end; gap:4px; height:130px; }
        .bcol { flex:1; height:100%; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; position:relative; }
        .bcol span { position:absolute; bottom:-18px; font-size:.65rem; color:var(--hc-muted); }
        .bbar { width:100%; max-width:22px; background:color-mix(in srgb, var(--hc-accent) 50%, transparent); border-radius:4px 4px 2px 2px; min-height:2px; }
        .bbar.today { background:var(--hc-accent); } .bbar.over { background:#ff9500; } .bbar.overm { background:#ff3b30; }
        .tline { position:absolute; left:0; right:0; border-top:1.5px dashed var(--hc-muted); opacity:.7; z-index:1; pointer-events:none; }
        .tline span { position:absolute; right:0; top:-15px; font-size:.65rem; color:var(--hc-muted); }
        .tline.mline { border-top-style:dotted; border-top-color:#ff3b30; } .tline.mline span { right:auto; left:0; color:#ff3b30; }
        .blegend { display:flex; gap:12px; flex-wrap:wrap; margin-top:4px; }
        .blegend .sw { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:4px; vertical-align:-1px; background:color-mix(in srgb, var(--hc-accent) 50%, transparent); }
        .blegend .sw.over { background:#ff9500; } .blegend .sw.overm { background:#ff3b30; }
        .tile { background:var(--hc-fill); border-radius:12px; padding:10px 12px; margin-top:10px; }
        .tiles { display:grid; grid-template-columns:1fr 1fr; gap:10px; } .tiles .tile { margin-top:10px; }
      </style>
      <ha-card><div class="title">${esc(cfg.title || "Last 14 days")}</div>${body}</ha-card>`;
  }
}

/* ===================================================== exercise progression */
const METRICS = {
  e1rm: { label: "Estimated 1RM" },
  weight: { label: "Heaviest set" },
  volume: { label: "Volume" },
  reps: { label: "Most reps" },
  duration_s: { label: "Longest" },
  distance_m: { label: "Farthest" },
};
class ExerciseProgressCard extends HACard {
  static getStubConfig() { return { exercise_name: "bench_press", time: 30 }; }
  get refreshEvery() { return 15 * 60 * 1000; }
  getCardSize() { return 4; }
  getGridOptions() { return { columns: 6, rows: 4, min_columns: 4, min_rows: 3 }; }

  setConfig(config) {
    if (!config || !config.exercise_name) throw new Error("Add exercise_name, e.g. exercise_name: bench_press");
    super.setConfig(config);
    this._data = null;
    if (this._hass) this.refresh();
  }

  /** time: a number of days, "30d", or all_time (the default). */
  get _days() {
    const t = String(this._config.time ?? "all_time").trim().toLowerCase();
    if (!t || /^all/.test(t)) return null;
    const n = parseInt(t, 10);
    if (!n || n < 1) throw new Error(`time should be a number of days or all_time, not "${this._config.time}"`);
    return n;
  }

  async refresh() {
    try {
      const days = this._days;
      this._data = await this.ws("exercises/progress", { exercise: String(this._config.exercise_name), ...(days ? { days } : {}) });
      this._error = null;
    } catch (e) { this._error = e.message || String(e); }
    this.render();
  }

  render() {
    const d = this._data, cfg = this._config;
    const title = cfg.title || d?.exercise?.name || String(cfg.exercise_name).replace(/_/g, " ");
    let range = "";
    try { range = this._days ? `Last ${this._days} days` : "All time"; } catch (_) { /* shown as error */ }
    let body = this._error ? `<div class="err">${esc(this._error)}</div>` : `<div class="muted small">Loading…</div>`;
    if (d && !this._error) {
      const kind = d.exercise.kind || "weight_reps";
      const metric = cfg.metric && METRICS[cfg.metric] ? cfg.metric
        : kind === "duration" ? "duration_s" : kind === "distance" ? "distance_m" : kind === "weight_reps" ? "e1rm" : "reps";
      const imp = d.units !== "metric";
      const fmt = (v) => metric === "duration_s" ? `${Math.floor(v / 60)}:${pad(Math.round(v % 60))}`
        : metric === "distance_m" ? `${r1(imp ? v / 1609.344 : v / 1000)} ${imp ? "mi" : "km"}`
        : metric === "reps" ? `${r0(v)} reps`
        : `${metric === "volume" ? r0(imp ? v * LB : v) : r1(imp ? v * LB : v)} ${imp ? "lb" : "kg"}`;
      const pts = d.points.map((p) => ({ t: new Date(p.date).getTime(), v: p[metric] || 0, p })).filter((p) => p.v > 0);
      if (!pts.length) {
        body = `<div class="empty muted small">No ${esc(d.exercise.name)} sets ${this._days ? `in the last ${this._days} days` : "logged yet"}.</div>`;
      } else {
        const W = 320, H = 140, PL = 40, PR = 10, PT = 10, PB = 22;
        const t0 = this._days ? Date.now() - this._days * 864e5 : pts[0].t, t1 = this._days ? Date.now() : pts[pts.length - 1].t;
        let v0 = Math.min(...pts.map((p) => p.v)), v1 = Math.max(...pts.map((p) => p.v));
        const padV = (v1 - v0) * 0.12 || v1 * 0.1 || 1; v0 = Math.max(0, v0 - padV); v1 += padV;
        const sx = (t) => PL + (t1 === t0 ? (W - PL - PR) / 2 : ((t - t0) / (t1 - t0)) * (W - PL - PR));
        const sy = (v) => PT + (1 - (v - v0) / (v1 - v0 || 1)) * (H - PT - PB);
        const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join("");
        const area = pts.length > 1 ? `${line}L${sx(pts[pts.length - 1].t).toFixed(1)},${H - PB}L${sx(pts[0].t).toFixed(1)},${H - PB}Z` : "";
        const grid = [0, 0.5, 1].map((f) => { const v = v0 + (v1 - v0) * f, y = sy(v).toFixed(1);
          return `<line x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}" class="grid"/><text x="${PL - 6}" y="${(+y + 3.5).toFixed(1)}" class="axis" text-anchor="end">${esc(fmt(v).replace(/ (lb|kg|reps|mi|km)$/, ""))}</text>`; }).join("");
        const dlabel = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(this._days ? {} : { year: "2-digit" }) });
        const best = pts.reduce((a, b) => (b.v > a.v ? b : a));
        const dots = pts.map((p) => `<circle cx="${sx(p.t).toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="${p === best ? 4.5 : 3}" class="dot ${p === best ? "best" : ""}"><title>${esc(dlabel(p.t))}: ${esc(fmt(p.v))} · ${p.p.sets} set${p.p.sets === 1 ? "" : "s"}</title></circle>`).join("");
        const first = pts[0], last = pts[pts.length - 1], diff = last.v - first.v;
        const change = pts.length > 1 ? `<span class="${diff > 0 ? "up" : diff < 0 ? "down" : "muted"}">${diff > 0 ? "▲" : diff < 0 ? "▼" : "="} ${esc(fmt(Math.abs(diff)))}</span> <span class="muted">since ${esc(dlabel(first.t))}</span>` : `<span class="muted">${esc(dlabel(last.t))}</span>`;
        body = `<div class="head"><div><div class="muted xsmall">${esc(METRICS[metric].label)} · latest</div><div class="big">${esc(fmt(last.v))}</div></div>
            <div class="right small">${change}<div class="muted xsmall">Best ${esc(fmt(best.v))} · ${pts.length} workout${pts.length === 1 ? "" : "s"}</div></div></div>
          <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.exercise.name)} ${esc(METRICS[metric].label)}">
            ${grid}${area ? `<path d="${area}" class="area"/>` : ""}<path d="${line}" class="line"/>${dots}
            <text x="${PL}" y="${H - 6}" class="axis">${esc(dlabel(t0))}</text><text x="${W - PR}" y="${H - 6}" class="axis" text-anchor="end">${esc(dlabel(t1))}</text>
          </svg>`;
      }
    }
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${NUTRI_CSS}
        .title { display:flex; justify-content:space-between; gap:8px; } .title .muted { font-weight:400; font-size:.8rem; }
        .head { display:flex; justify-content:space-between; align-items:flex-end; gap:8px; margin-bottom:4px; }
        .right { text-align:right; } .up { color:#34c759; font-weight:600; } .down { color:#ff3b30; font-weight:600; }
        svg { width:100%; display:block; overflow:visible; }
        .grid { stroke:var(--hc-line); stroke-width:1; } .axis { font-size:9px; fill:var(--hc-muted); }
        .line { fill:none; stroke:var(--hc-accent); stroke-width:2.2; stroke-linejoin:round; stroke-linecap:round; }
        .area { fill:color-mix(in srgb, var(--hc-accent) 14%, transparent); }
        .dot { fill:var(--card-background-color, #fff); stroke:var(--hc-accent); stroke-width:2; } .dot.best { fill:#ffcc00; stroke:#ff9500; }
        .empty { padding:18px 0; text-align:center; }
      </style>
      <ha-card><div class="title"><span>${esc(title)}</span><span class="muted">${esc(range)}</span></div>${body}</ha-card>`;
  }
}

const define = (name, cls) => { if (!customElements.get(name)) customElements.define(name, cls); };
define("health-assistant-lift-calendar", LiftCalendarCard);
define("health-assistant-calorie-gauge", CalorieGaugeCard);
define("health-assistant-log-meal", LogMealCard);
define("health-assistant-log-meal-dialog", LogMealDialog);
define("health-assistant-nutrition-today", NutritionTodayCard);
define("health-assistant-nutrition-averages", NutritionAveragesCard);
define("health-assistant-calorie-history", CalorieHistoryCard);
define("health-assistant-exercise-progress", ExerciseProgressCard);

window.customCards = window.customCards || [];
const add = (type, name, description) => { if (!window.customCards.some((c) => c.type === type)) window.customCards.push({ type, name, description, preview: true, documentationURL: "https://github.com/tjsanzen/health-assistant" }); };
add("health-assistant-lift-calendar", "Health Assistant: Lifting calendar", "This month at a glance — days you lifted are circled in green.");
add("health-assistant-calorie-gauge", "Health Assistant: Calories today", "Today's calories as a speedometer against your target.");
add("health-assistant-log-meal", "Health Assistant: Log meal button", "A button that opens a dialog to log food.");
add("health-assistant-nutrition-today", "Health Assistant: Calories & macros today", "Today's calorie ring with protein, carbs, fat and fiber bars.");
add("health-assistant-nutrition-averages", "Health Assistant: Nutrition averages", "Average calories and macros over 7 days, 30 days and all time.");
add("health-assistant-calorie-history", "Health Assistant: Last 14 days", "Daily calories against your target and maintenance, with fat burned this week.");
add("health-assistant-exercise-progress", "Health Assistant: Exercise progress", "A graph of one exercise over time, e.g. exercise_name: bench_press, time: 30.");
})();
