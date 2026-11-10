/* Health Assistant — sidebar panel for Home Assistant.
 * Plain web component, no build step. Talks to the integration over websocket
 * (health_assistant/* commands). All data is stored metric; converted here for display.
 */
const DOMAIN = "health_assistant";
const LB = 2.2046226218;
const OZ_G = 28.349523125;
const MI_M = 1609.344;
const MEALS = ["breakfast", "lunch", "dinner", "snack"];
const SET_TYPES = ["working", "warmup", "failure", "drop"];
const TABS = [
  { id: "history", label: "History", icon: "mdi:history" },
  { id: "workout", label: "Start Workout", icon: "mdi:plus" },
  { id: "nutrition", label: "Nutrition", icon: "mdi:silverware-fork-knife" },
  { id: "profile", label: "Profile", icon: "mdi:account-circle" },
];
const VITALS = {
  weight: { label: "Weight", icon: "mdi:scale-bathroom" },
  body_fat: { label: "Body fat", icon: "mdi:percent", unit: "%" },
  blood_pressure: { label: "Blood pressure", icon: "mdi:heart", unit: "mmHg" },
  heart_rate: { label: "Heart rate", icon: "mdi:heart-pulse", unit: "bpm" },
  hrv: { label: "HRV", icon: "mdi:pulse", unit: "ms" },
  spo2: { label: "Blood oxygen", icon: "mdi:water-percent", unit: "%" },
  respiration: { label: "Respiration", icon: "mdi:lungs", unit: "br/min" },
  height: { label: "Height", icon: "mdi:human-male-height" },
};
const PR_LABELS = {
  max_weight: "Heaviest weight", max_e1rm: "Best est. 1RM",
  max_reps: "Most reps", max_volume_set: "Best set volume",
};

/* ---------------------------------------------------------------- helpers */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r0 = (n) => (n == null || isNaN(n) ? "–" : Math.round(n).toLocaleString());
const r1 = (n) => (n == null || isNaN(n) ? "–" : (Math.round(n * 10) / 10).toLocaleString());
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n) => String(n).padStart(2, "0");
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return localDate(d); };
const fmtDur = (s) => { if (s == null) return "–"; s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
const fmtDate = (iso, opts = { weekday: "short", month: "short", day: "numeric" }) => new Date(iso).toLocaleDateString(undefined, opts);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const num = (v) => (v === "" || v == null ? null : Number(v));
const toLocalInput = (d = new Date()) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const icon = (name, cls = "") => `<ha-icon class="${cls}" icon="${name}"></ha-icon>`;

class Units {
  constructor(system) { this.imp = system === "imperial"; }
  get w() { return this.imp ? "lb" : "kg"; }
  wOut(kg, digits = 1) { if (kg == null) return null; const v = this.imp ? kg * LB : kg; const f = 10 ** digits; return Math.round(v * f) / f; }
  wIn(v) { return v == null || v === "" ? null : (this.imp ? Number(v) / LB : Number(v)); }
  h(cm) { if (cm == null) return "–"; if (!this.imp) return `${r0(cm)} cm`; const t = cm / 2.54; let ft = Math.floor(t / 12), inch = Math.round(t - ft * 12); if (inch === 12) { ft++; inch = 0; } return `${ft}′ ${inch}″`; }
  get d() { return this.imp ? "mi" : "km"; }
  dOut(m) { return m == null ? null : Math.round((this.imp ? m / MI_M : m / 1000) * 100) / 100; }
  dIn(v) { return v == null || v === "" ? null : Number(v) * (this.imp ? MI_M : 1000); }
}

/* Nutrient maths for a food + portion. */
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
function perServingKcal(food) { return portion(food, 1, "serving").kcal; }

/* ================================================================== panel */
class HealthAssistantPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._s = {
      tab: localStorage.getItem("ha-health-tab") || "nutrition",
      profiles: [], profileId: null, overview: null, loading: true, error: null,
      historyMode: "workouts", workouts: null, workoutsTotal: 0, records: null,
      templates: null, exercises: [], active: null, last: {},
      day: localDate(), food: null, vitals: {}, sheets: [], rest: null,
    };
    this._saveTimer = null;
    this._tick = null;
  }

  set hass(h) { const first = !this._hass; this._hass = h; if (first) this._boot(); }
  get hass() { return this._hass; }
  set narrow(n) { const changed = this._narrow !== n; this._narrow = n; if (changed && this._booted) this._renderShell(); }
  set panel(p) { this._panel = p; }

  connectedCallback() {
    this._tick = setInterval(() => this._onTick(), 1000);
    this._vis = () => { if (document.visibilityState === "hidden") this._flushWorkout(); else if (this._booted) this._refreshActive(); };
    document.addEventListener("visibilitychange", this._vis);
  }
  disconnectedCallback() {
    clearInterval(this._tick);
    document.removeEventListener("visibilitychange", this._vis);
    this._flushWorkout();
  }

  /* ------------------------------------------------------------- data I/O */
  async ws(cmd, data = {}) {
    const msg = { type: `${DOMAIN}/${cmd}`, ...data };
    if (this._s.profileId && cmd !== "profiles") msg.profile_id = this._s.profileId;
    return this._hass.callWS(msg);
  }

  async _boot() {
    this._booted = true;
    this._renderShell();
    try {
      const profiles = await this.ws("profiles");
      this._s.profiles = profiles;
      if (!profiles.length) { this._s.loading = false; this._s.error = "noprofile"; return this._render(); }
      const saved = localStorage.getItem("ha-health-profile");
      this._s.profileId = (profiles.find((p) => p.id === saved) || profiles.find((p) => p.mine) || profiles[0]).id;
      await this._loadAll();
    } catch (e) {
      this._s.error = e.message || String(e);
    }
    this._s.loading = false;
    this._renderShell();
  }

  async _loadAll() {
    const [overview, exercises, templates, active] = await Promise.all([
      this.ws("overview", { date: this._s.day }), this.ws("exercises/list"),
      this.ws("templates/list"), this.ws("workout/active"),
    ]);
    Object.assign(this._s, { overview, exercises, templates, active, food: overview.today });
    this._exMap = Object.fromEntries(exercises.map((e) => [e.id, e]));
    this._units = new Units(overview.profile.units);
    if (active) await this._loadLast(active.exercises.map((e) => e.exercise_id));
    await this._loadTab();
  }

  async _loadTab() {
    const s = this._s;
    if (s.tab === "history") {
      if (s.historyMode === "workouts" && !s.workouts) {
        const res = await this.ws("workout/list", { offset: 0, limit: 20 });
        s.workouts = res.items; s.workoutsTotal = res.total;
      }
      if (s.historyMode === "records" && !s.records) s.records = await this.ws("records");
    }
    if (s.tab === "nutrition") s.food = await this.ws("food/day", { date: s.day });
    if (s.tab === "profile") {
      const [overview, weights] = await Promise.all([this.ws("overview", { date: localDate() }), this.ws("vitals/list", { vital_type: "weight", limit: 365 })]);
      s.overview = overview; s.vitals.weight = weights;
    }
  }

  async _refreshOverview() { this._s.overview = await this.ws("overview", { date: localDate() }); }
  async _refreshActive() { try { const a = await this.ws("workout/active"); if (JSON.stringify(a) !== JSON.stringify(this._s.active) && !this._saveTimer) { this._s.active = a; if (this._s.tab === "workout") this._render(); } } catch (_) { /* ignore */ } }

  async _loadLast(ids) {
    const need = ids.filter((id) => !(id in this._s.last));
    if (!need.length) return;
    Object.assign(this._s.last, await this.ws("exercises/last", { exercise_ids: need }));
  }

  _queueWorkoutSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._flushWorkout(), 700);
  }
  async _flushWorkout() {
    if (!this._saveTimer) return;
    clearTimeout(this._saveTimer); this._saveTimer = null;
    if (!this._s.active) return;
    try { await this.ws("workout/update", { workout: this._s.active }); } catch (e) { this._toast(e.message, true); }
  }

  /* ------------------------------------------------------------- shell */
  _renderShell() {
    const root = this.shadowRoot;
    root.innerHTML = `<style>${STYLES}</style>
      <div class="app ${this._narrow ? "narrow" : "wide"}">
        <header class="top">
          ${this._narrow ? `<button class="iconbtn" data-action="menu" aria-label="Menu">${icon("mdi:menu")}</button>` : ""}
          <div class="title">${icon("mdi:food-apple", "brand")}<span>Health</span></div>
          <nav class="topnav" id="topnav"></nav>
          <div class="spacer"></div>
          <div id="profilepick"></div>
        </header>
        <main id="content"></main>
        <div id="rest"></div>
        <nav class="bottomnav" id="bottomnav"></nav>
        <div id="sheet"></div>
        <div id="toast"></div>
      </div>`;
    if (!this._wired) {
      root.addEventListener("click", (e) => this._onClick(e));
      root.addEventListener("input", (e) => this._onInput(e));
      root.addEventListener("change", (e) => this._onChange(e));
      root.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset.enter) { e.preventDefault(); this._act(e.target.dataset.enter, e.target, e); } });
      this._wired = true;
    }
    this._render();
  }

  _render() {
    const root = this.shadowRoot;
    if (!root.getElementById("content")) return;
    const navHtml = TABS.map((t) => {
      const active = this._s.tab === t.id;
      const isWorkout = t.id === "workout";
      const label = isWorkout && this._s.active ? `<span data-elapsed>${fmtDur(this._elapsed())}</span>` : t.label;
      return `<button class="navbtn ${active ? "on" : ""} ${isWorkout ? "center" : ""}" data-action="tab" data-tab="${t.id}">
        <span class="navicon">${icon(isWorkout && this._s.active ? "mdi:dumbbell" : t.icon)}</span><span class="navlabel">${label}</span></button>`;
    }).join("");
    root.getElementById("bottomnav").innerHTML = navHtml;
    root.getElementById("topnav").innerHTML = navHtml;
    root.getElementById("profilepick").innerHTML = this._s.profiles.length > 1
      ? `<select class="profilesel" data-change="profile">${this._s.profiles.map((p) => `<option value="${p.id}" ${p.id === this._s.profileId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>` : "";
    const content = root.getElementById("content");
    const scroll = content.scrollTop;
    content.innerHTML = `<div class="wrap">${this._view()}</div>`;
    content.scrollTop = scroll;
    this._renderSheet();
    this._renderRest();
  }

  _view() {
    const s = this._s;
    if (s.loading) return `<div class="empty">Loading…</div>`;
    if (s.error === "noprofile") return `<div class="card empty"><h2>No profile yet</h2><p>Add the <b>Health Assistant</b> integration in Settings → Devices & services to create your profile.</p></div>`;
    if (s.error) return `<div class="card empty"><h2>Something went wrong</h2><p>${esc(s.error)}</p></div>`;
    switch (s.tab) {
      case "history": return this._viewHistory();
      case "workout": return this._viewWorkout();
      case "nutrition": return this._viewNutrition();
      case "profile": return this._viewProfile();
    }
    return "";
  }

  /* ============================================================ HISTORY */
  _viewHistory() {
    const s = this._s;
    const seg = `<div class="seg">
      <button class="${s.historyMode === "workouts" ? "on" : ""}" data-action="historyMode" data-mode="workouts">Workouts</button>
      <button class="${s.historyMode === "records" ? "on" : ""}" data-action="historyMode" data-mode="records">Records</button></div>`;
    if (s.historyMode === "records") return seg + this._viewRecords();
    if (!s.workouts) return seg + `<div class="empty">Loading…</div>`;
    if (!s.workouts.length) return seg + `<div class="card empty">${icon("mdi:dumbbell", "bigicon")}<h2>No workouts yet</h2><p>Finished workouts show up here.</p><button class="btn primary" data-action="tab" data-tab="workout">Start a workout</button></div>`;
    let month = "";
    const items = s.workouts.map((w) => {
      const m = fmtDate(w.started_at, { month: "long", year: "numeric" });
      const head = m !== month ? `<h3 class="month">${m}</h3>` : "";
      month = m;
      const sm = w.summary || {};
      const lines = w.exercises.slice(0, 4).map((e) => `<div class="exline"><span>${e.sets.length} × ${esc(this._exName(e.exercise_id))}</span><span class="muted">${this._bestSetText(e)}</span></div>`).join("");
      const more = w.exercises.length > 4 ? `<div class="muted small">+${w.exercises.length - 4} more</div>` : "";
      return `${head}<button class="card workout" data-action="openWorkout" data-id="${w.id}">
        <div class="row between"><b>${esc(w.name)}</b>${prCount(w) ? `<span class="badge gold">${icon("mdi:trophy")} ${prCount(w)} PR${prCount(w) > 1 ? "s" : ""}</span>` : ""}</div>
        <div class="muted small">${fmtDate(w.started_at)} · ${fmtTime(w.started_at)}</div>
        <div class="stats">
          <span>${icon("mdi:timer-outline")} ${fmtDur(sm.duration_s)}</span>
          <span>${icon("mdi:weight")} ${r0(this._units.wOut(sm.volume_kg, 0))} ${this._units.w}</span>
          <span>${icon("mdi:format-list-numbered")} ${sm.sets} sets</span>
        </div>${lines}${more}</button>`;
    }).join("");
    const loadMore = s.workouts.length < s.workoutsTotal ? `<button class="btn ghost full" data-action="moreWorkouts">Load more</button>` : "";
    return seg + items + loadMore;
  }

  _bestSetText(ex) {
    const kind = this._exMap[ex.exercise_id]?.kind;
    const counted = ex.sets.filter((x) => x.type !== "warmup");
    if (!counted.length) return "";
    if (kind === "duration") return fmtDur(Math.max(...counted.map((x) => x.duration_s || 0)));
    if (kind === "distance") return `${r1(this._units.dOut(Math.max(...counted.map((x) => x.distance_m || 0))))} ${this._units.d}`;
    const best = counted.reduce((a, b) => ((b.weight || 0) * (1 + (b.reps || 0) / 30) > (a.weight || 0) * (1 + (a.reps || 0) / 30) ? b : a));
    return best.weight ? `${r1(this._units.wOut(best.weight))} ${this._units.w} × ${best.reps ?? "–"}` : `${best.reps ?? "–"} reps`;
  }

  _viewRecords() {
    const recs = this._s.records;
    if (!recs) return `<div class="empty">Loading…</div>`;
    if (!recs.length) return `<div class="card empty">${icon("mdi:trophy", "bigicon")}<h2>No records yet</h2><p>Complete a workout to start setting records.</p></div>`;
    const u = this._units;
    return recs.map((r) => {
      const kind = r.exercise.kind;
      let cells;
      if (kind === "duration") cells = [["Longest", fmtDur(r.max_duration_s?.value)]];
      else if (kind === "distance") cells = [["Farthest", `${r1(u.dOut(r.max_distance_m?.value))} ${u.d}`]];
      else if (kind === "bodyweight_reps") cells = [["Most reps", r.max_reps?.value ?? "–"], ["Heaviest", r.max_weight ? `${r1(u.wOut(r.max_weight.value))} ${u.w}` : "–"]];
      else cells = [
        ["Heaviest", r.max_weight ? `${r1(u.wOut(r.max_weight.value))} ${u.w}` : "–"],
        ["Est. 1RM", r.max_e1rm ? `${r1(u.wOut(r.max_e1rm.value))} ${u.w}` : "–"],
        ["Best set", r.max_volume_set ? `${r1(u.wOut(r.max_volume_set.weight))} × ${r.max_volume_set.reps}` : "–"],
      ];
      return `<button class="card record" data-action="openExercise" data-id="${r.exercise.id}">
        <div class="row between"><b>${esc(r.exercise.name)}</b><span class="muted small">${esc(r.exercise.muscle || "")}</span></div>
        <div class="recgrid">${cells.map(([k, v]) => `<div><div class="muted small">${k}</div><div class="recval">${v}</div></div>`).join("")}</div></button>`;
    }).join("");
  }

  _sheetWorkout(w) {
    const u = this._units;
    const sm = w.summary || {};
    const byEx = {};
    (w.prs || []).forEach((p) => (byEx[p.exercise_id] = [...(byEx[p.exercise_id] || []), PR_LABELS[p.kind] || p.kind]));
    const prs = Object.entries(byEx).map(([id, kinds]) => `<div class="pr">${icon("mdi:trophy")} <b>${esc(this._exName(id))}</b> — ${kinds.join(", ")}</div>`).join("");
    const exs = w.exercises.map((e) => {
      let n = 0;
      const rows = e.sets.map((x) => {
        if (x.type === "working") n++;
        return `<tr><td>${this._setBadge(x.type, n)}</td><td>${this._setText(e.exercise_id, x)}</td><td class="muted">${x.rpe ? `RPE ${x.rpe}` : ""}</td></tr>`;
      }).join("");
      return `<div class="detailex"><b>${esc(this._exName(e.exercise_id))}</b>${e.notes ? `<div class="muted small">${esc(e.notes)}</div>` : ""}<table class="settable">${rows}</table></div>`;
    }).join("");
    return `<h2>${esc(w.name)}</h2>
      <div class="muted">${fmtDate(w.started_at, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · ${fmtTime(w.started_at)}</div>
      <div class="stats big"><span>${icon("mdi:timer-outline")} ${fmtDur(sm.duration_s)}</span><span>${icon("mdi:weight")} ${r0(u.wOut(sm.volume_kg, 0))} ${u.w}</span><span>${icon("mdi:format-list-numbered")} ${sm.sets} sets</span></div>
      ${prs ? `<div class="prs">${prs}</div>` : ""}
      ${w.notes ? `<p>${esc(w.notes)}</p>` : ""}
      ${exs}
      <div class="actions">
        <button class="btn" data-action="templateFromWorkout" data-id="${w.id}">${icon("mdi:content-save-outline")} Save as template</button>
        <button class="btn danger" data-action="deleteWorkout" data-id="${w.id}">${icon("mdi:delete-outline")} Delete</button>
      </div>`;
  }

  _setText(exId, x) {
    const kind = this._exMap[exId]?.kind;
    const u = this._units;
    if (kind === "duration") return fmtDur(x.duration_s);
    if (kind === "distance") return `${r1(u.dOut(x.distance_m))} ${u.d}${x.duration_s ? ` · ${fmtDur(x.duration_s)}` : ""}`;
    if (kind === "bodyweight_reps") return `${x.weight ? `+${r1(u.wOut(x.weight))} ${u.w} × ` : ""}${x.reps ?? "–"} reps`;
    return `${r1(u.wOut(x.weight))} ${u.w} × ${x.reps ?? "–"}`;
  }

  _prevText(kind, x) {
    const u = this._units;
    if (kind === "duration") return fmtDur(x.duration_s);
    if (kind === "distance") return `${r1(u.dOut(x.distance_m))} ${u.d}`;
    if (kind === "bodyweight_reps") return `${x.weight ? `+${r1(u.wOut(x.weight))}×` : ""}${x.reps ?? "–"}`;
    return `${r1(u.wOut(x.weight))}×${x.reps ?? "–"}`;
  }

  _setBadge(type, n) {
    const map = { warmup: ["W", "warm"], failure: ["F", "fail"], drop: ["D", "drop"] };
    const [t, c] = map[type] || [String(n), "work"];
    return `<span class="setbadge ${c}">${t}</span>`;
  }

  async _sheetExercise(id) {
    const ex = this._exMap[id];
    const hist = await this.ws("exercises/history", { exercise_id: id });
    const pts = hist.filter((h) => h.best_e1rm).map((h) => ({ x: new Date(h.date).getTime(), y: this._units.wOut(h.best_e1rm) })).reverse();
    const rows = hist.slice(0, 15).map((h) => `<div class="histrow"><div class="muted small">${fmtDate(h.date)}</div><div>${h.sets.filter((x) => x.type !== "warmup").map((x) => this._setText(id, x)).join(", ")}</div></div>`).join("");
    return `<h2>${esc(ex?.name || id)}</h2><div class="muted">${esc(ex?.muscle || "")} · ${esc(ex?.equipment || "")}</div>
      ${pts.length > 1 ? `<h3>Estimated 1RM (${this._units.w})</h3>${lineChart(pts)}` : ""}
      <h3>History</h3>${rows || `<p class="muted">No sets logged yet.</p>`}`;
  }

  /* ============================================================ WORKOUT */
  _viewWorkout() {
    const s = this._s;
    if (s.active) return this._viewActive();
    const tpls = (s.templates || []).map((t) => `<div class="card tpl">
        <div class="row between"><b>${esc(t.name)}</b>
          <div class="row"><button class="iconbtn sm" data-action="editTemplate" data-id="${t.id}" aria-label="Edit">${icon("mdi:pencil")}</button>
          <button class="iconbtn sm" data-action="deleteTemplate" data-id="${t.id}" aria-label="Delete">${icon("mdi:delete-outline")}</button></div></div>
        <div class="muted small">${t.exercises.map((e) => `${e.sets.length} × ${esc(this._exName(e.exercise_id))}`).join(" · ") || "No exercises"}</div>
        <button class="btn primary full" data-action="startWorkout" data-template="${t.id}">${icon("mdi:play")} Start</button></div>`).join("");
    return `<div class="card hero">
        ${icon("mdi:dumbbell", "bigicon")}
        <h2>Ready to train?</h2>
        <button class="btn primary big full" data-action="startWorkout">${icon("mdi:plus")} Start empty workout</button>
      </div>
      <div class="row between section"><h3>Templates</h3><button class="btn ghost" data-action="newTemplate">${icon("mdi:plus")} New template</button></div>
      ${tpls || `<div class="card empty small"><p>Save a workout as a template, or create one to start faster next time.</p></div>`}`;
  }

  _viewActive() {
    const w = this._s.active;
    const u = this._units;
    const exs = w.exercises.map((e, ei) => {
      const ex = this._exMap[e.exercise_id] || { name: e.exercise_id, kind: "weight_reps" };
      const last = this._s.last[e.exercise_id] || [];
      const kind = ex.kind;
      const head = kind === "duration" ? ["Time (s)"] : kind === "distance" ? [u.d, "Min"] : kind === "bodyweight_reps" ? [`+${u.w}`, "Reps"] : [u.w, "Reps"];
      let n = 0;
      const rows = e.sets.map((x, si) => {
        if (x.type === "working") n++;
        const prev = prevFor(last, e.sets, si);
        const prevTxt = prev ? this._prevText(kind, prev) : "–";
        let inputs;
        if (kind === "duration") inputs = `<input class="cell" inputmode="numeric" data-set="duration_s" data-e="${ei}" data-s="${si}" value="${x.duration_s ?? ""}" placeholder="${prev?.duration_s ?? ""}">`;
        else if (kind === "distance") inputs = `<input class="cell" inputmode="decimal" data-set="distance" data-e="${ei}" data-s="${si}" value="${x.distance_m != null ? u.dOut(x.distance_m) : ""}" placeholder="${prev?.distance_m != null ? u.dOut(prev.distance_m) : ""}">
            <input class="cell" inputmode="decimal" data-set="minutes" data-e="${ei}" data-s="${si}" value="${x.duration_s != null ? r1(x.duration_s / 60) : ""}">`;
        else inputs = `<input class="cell" inputmode="decimal" data-set="weight" data-e="${ei}" data-s="${si}" value="${x.weight != null ? u.wOut(x.weight) : ""}" placeholder="${prev?.weight != null ? u.wOut(prev.weight) : ""}">
            <input class="cell" inputmode="numeric" data-set="reps" data-e="${ei}" data-s="${si}" value="${x.reps ?? ""}" placeholder="${prev?.reps ?? ""}">`;
        const rpe = `<select class="cell rpe" data-set="rpe" data-e="${ei}" data-s="${si}"><option value="">–</option>${[6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((v) => `<option ${x.rpe == v ? "selected" : ""}>${v}</option>`).join("")}</select>`;
        return `<div class="setrow ${x.completed ? "done" : ""} k-${kind}">
          <button class="setbtn" data-action="cycleType" data-e="${ei}" data-s="${si}" aria-label="Set type">${this._setBadge(x.type, n)}</button>
          <button class="prev" data-action="usePrev" data-e="${ei}" data-s="${si}">${esc(prevTxt)}</button>
          ${inputs}${rpe}
          <button class="check ${x.completed ? "on" : ""}" data-action="toggleSet" data-e="${ei}" data-s="${si}" aria-label="Complete set">${icon("mdi:check")}</button>
          <button class="iconbtn xs del" data-action="removeSet" data-e="${ei}" data-s="${si}" aria-label="Remove set">${icon("mdi:close")}</button>
        </div>`;
      }).join("");
      return `<div class="card exercise">
        <div class="row between"><button class="linklike" data-action="openExercise" data-id="${e.exercise_id}"><b>${esc(ex.name)}</b></button>
          <button class="iconbtn sm" data-action="removeExercise" data-e="${ei}" aria-label="Remove exercise">${icon("mdi:delete-outline")}</button></div>
        <input class="note" placeholder="Notes" data-exnote="${ei}" value="${esc(e.notes || "")}">
        <div class="sethead k-${kind}"><span>Set</span><span>Previous</span>${head.map((h) => `<span>${h}</span>`).join("")}<span>RPE</span><span></span><span></span></div>
        ${rows}
        <button class="btn ghost full" data-action="addSet" data-e="${ei}">${icon("mdi:plus")} Add set</button>
      </div>`;
    }).join("");
    return `<div class="card activehead">
        <input class="wname" data-wfield="name" value="${esc(w.name)}" aria-label="Workout name">
        <div class="row between"><span class="timer">${icon("mdi:timer-outline")} <span data-elapsed>${fmtDur(this._elapsed())}</span></span>
          <button class="btn primary" data-action="finishWorkout">Finish</button></div>
      </div>
      ${exs}
      <button class="btn primary full big" data-action="addExercise">${icon("mdi:plus")} Add exercise</button>
      <textarea class="wnotes" data-wfield="notes" placeholder="Workout notes">${esc(w.notes || "")}</textarea>
      <button class="btn danger ghost full" data-action="discardWorkout">Discard workout</button>`;
  }

  _elapsed() { const a = this._s.active; return a ? (Date.now() - new Date(a.started_at).getTime()) / 1000 : 0; }

  _onTick() {
    if (this._s.active) this.shadowRoot.querySelectorAll("[data-elapsed]").forEach((el) => (el.textContent = fmtDur(this._elapsed())));
    if (this._s.rest) {
      const left = (this._s.rest.endsAt - Date.now()) / 1000;
      if (left <= 0) { this._s.rest = null; this._buzz(); }
      this._renderRest();
    }
  }
  _buzz() { try { navigator.vibrate?.([200, 100, 200]); } catch (_) { /* iOS has no vibrate */ } this._toast("Rest over — next set!"); }

  _renderRest() {
    const el = this.shadowRoot.getElementById("rest");
    if (!el) return;
    const r = this._s.rest;
    if (!r) { el.innerHTML = ""; return; }
    const left = Math.max(0, (r.endsAt - Date.now()) / 1000);
    const pct = Math.min(100, (left / r.total) * 100);
    el.innerHTML = `<div class="restbar"><div class="restfill" style="width:${pct}%"></div>
      <span>${icon("mdi:timer-sand")} Rest ${fmtDur(left)}</span>
      <div class="row"><button class="btn sm" data-action="restAdj" data-d="-15">−15</button><button class="btn sm" data-action="restAdj" data-d="15">+15</button><button class="btn sm" data-action="restSkip">Skip</button></div></div>`;
  }

  /* ========================================================== NUTRITION */
  _viewNutrition() {
    const s = this._s;
    const f = s.food;
    if (!f) return `<div class="empty">Loading…</div>`;
    const today = localDate();
    const dayLabel = s.day === today ? "Today" : s.day === addDays(today, -1) ? "Yesterday" : fmtDate(s.day + "T12:00:00");
    const t = f.totals, mt = f.macro_targets || {};
    const target = f.target || 0;
    const ring = ringChart(t.kcal, target);
    const macro = (k, label, cls) => {
      const goal = mt[k] || 0, val = t[k] || 0;
      return `<div class="macro"><div class="row between small"><span>${label}</span><span class="muted">${r0(val)} / ${r0(goal)} g</span></div>
        <div class="bar"><div class="fill ${cls}" style="width:${goal ? Math.min(100, (val / goal) * 100) : 0}%"></div></div></div>`;
    };
    const meals = MEALS.map((m) => {
      const items = f.entries.filter((e) => e.meal === m);
      const kcal = items.reduce((a, e) => a + (e.kcal || 0), 0);
      return `<div class="card meal"><div class="row between"><h3>${cap(m)}</h3><span class="muted">${r0(kcal)} kcal</span></div>
        ${items.map((e) => `<button class="foodrow" data-action="editFood" data-id="${e.id}">
          <div><div>${esc(e.name)}${e.brand ? ` <span class="muted small">${esc(e.brand)}</span>` : ""}</div>
          <div class="muted small">${this._amountText(e)} · P ${r0(e.protein)} · C ${r0(e.carbs)} · F ${r0(e.fat)}</div></div>
          <span class="kcal">${r0(e.kcal)}</span></button>`).join("")}
        <button class="btn ghost full" data-action="addFood" data-meal="${m}">${icon("mdi:plus")} Add food</button></div>`;
    }).join("");
    return `<div class="datenav"><button class="iconbtn" data-action="day" data-d="-1" aria-label="Previous day">${icon("mdi:chevron-left")}</button>
        <button class="linklike" data-action="dayToday"><b>${dayLabel}</b></button>
        <button class="iconbtn" data-action="day" data-d="1" ${s.day >= today ? "disabled" : ""} aria-label="Next day">${icon("mdi:chevron-right")}</button></div>
      <div class="card summary">
        <div class="ringwrap">${ring}<div class="ringtext"><div class="big">${r0(Math.abs(f.remaining ?? 0))}</div><div class="muted small">${(f.remaining ?? 0) >= 0 ? "kcal left" : "kcal over"}</div></div></div>
        <div class="sumright">
          <div class="row between small"><span>Eaten</span><b>${r0(t.kcal)}</b></div>
          <div class="row between small"><span>Target</span><b>${r0(target)}</b></div>
          ${macro("protein", "Protein", "p")}${macro("carbs", "Carbs", "c")}${macro("fat", "Fat", "f")}
        </div>
      </div>
      ${s.overview && !s.overview.food_db ? `<div class="card warn small">Food database not found — search shows only your custom foods. See the README to build it.</div>` : ""}
      ${meals}`;
  }

  _amountText(e) {
    if (e.unit === "g") return `${r0(e.amount)} g`;
    if (e.unit === "oz") return `${r1(e.amount)} oz`;
    if (e.unit === "quick") return "Quick add";
    return `${r1(e.amount)} serving${e.amount === 1 ? "" : "s"}${e.grams ? ` (${r0(e.grams)} g)` : ""}`;
  }

  _sheetAddFood(sh) {
    const tabs = ["search", "quick", "custom"].map((t) => `<button class="${sh.mode === t ? "on" : ""}" data-action="foodMode" data-mode="${t}">${{ search: "Search", quick: "Quick add", custom: "New food" }[t]}</button>`).join("");
    let body = "";
    if (sh.mode === "search") {
      body = `<div class="searchbox">${icon("mdi:magnify")}<input id="foodq" type="search" placeholder="Search foods" value="${esc(sh.query || "")}" data-input="foodSearch" autocomplete="off" enterkeyhint="search"></div>
        <div id="foodresults">${this._foodResults(sh)}</div>`;
    } else if (sh.mode === "quick") {
      body = `<div class="form">
        <label>Name<input data-q="name" value="Quick add" ></label>
        <div class="grid2"><label>Calories<input data-q="kcal" inputmode="decimal"></label><label>Protein (g)<input data-q="protein" inputmode="decimal"></label>
        <label>Carbs (g)<input data-q="carbs" inputmode="decimal"></label><label>Fat (g)<input data-q="fat" inputmode="decimal"></label></div>
        <button class="btn primary full" data-action="quickAdd">Add to ${cap(sh.meal)}</button></div>`;
    } else {
      body = `<div class="form">
        <label>Name<input data-c="name"></label><label>Brand (optional)<input data-c="brand"></label>
        <div class="grid2"><label>Serving size<input data-c="serving_qty" inputmode="decimal" value="1"></label><label>Serving unit<input data-c="serving_unit" value="serving"></label></div>
        <label>Serving weight in grams (optional)<input data-c="serving_g" inputmode="decimal"></label>
        <p class="muted small">Nutrition per serving</p>
        <div class="grid2"><label>Calories<input data-c="kcal" inputmode="decimal"></label><label>Protein (g)<input data-c="protein" inputmode="decimal"></label>
        <label>Carbs (g)<input data-c="carbs" inputmode="decimal"></label><label>Fat (g)<input data-c="fat" inputmode="decimal"></label></div>
        <button class="btn primary full" data-action="createCustomFood">Save food</button></div>`;
    }
    return `<h2>Add to ${cap(sh.meal)}</h2><div class="seg">${tabs}</div>${body}`;
  }

  _foodResults(sh) {
    const row = (f, src, i) => `<button class="foodrow" data-action="pickFood" data-src="${src}" data-i="${i}">
      <div><div>${esc(f.name)}${f.brand ? ` <span class="muted small">${esc(f.brand)}</span>` : ""}</div>
      <div class="muted small">${esc(servingLabel(f))}</div></div><span class="kcal">${r0(perServingKcal(f))}</span></button>`;
    if (!sh.query) {
      const recent = sh.recent || [];
      const custom = sh.custom || [];
      if (!recent.length && !custom.length) return `<p class="muted center">Search 300,000+ foods from OpenNutrition.</p>`;
      return (recent.length ? `<h3>Recent</h3>${recent.map((f, i) => row(f, "recent", i)).join("")}` : "") +
        (custom.length ? `<h3>My foods</h3>${custom.map((f, i) => row(f, "custom", i)).join("")}` : "");
    }
    if (sh.searching && !sh.results) return `<p class="muted center">Searching…</p>`;
    const res = sh.results || { custom: [], results: [] };
    if (!res.custom.length && !res.results.length) return `<p class="muted center">No matches. Try fewer words, or add it under “New food”.</p>`;
    return (res.custom.length ? `<h3>My foods</h3>${res.custom.map((f, i) => row(f, "rcustom", i)).join("")}` : "") +
      res.results.map((f, i) => row(f, "results", i)).join("");
  }

  _sheetPortion(sh) {
    const f = sh.food;
    const p = portion(f, sh.amount, sh.unit);
    const units = [["serving", `serving (${servingLabel(f)})`]];
    if (f.per_100g || f.serving_g) units.push(["g", "grams"], ["oz", "ounces"]);
    return `<h2>${esc(f.name)}</h2>${f.brand ? `<div class="muted">${esc(f.brand)}</div>` : ""}
      <div class="portion">
        <input class="amount" inputmode="decimal" data-input="portionAmount" value="${sh.amount}" aria-label="Amount">
        <select data-change="portionUnit">${units.map(([v, l]) => `<option value="${v}" ${sh.unit === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
      </div>
      <div class="nutri" id="nutri">${this._nutriHtml(p)}</div>
      <label class="inline">Meal <select data-change="portionMeal">${MEALS.map((m) => `<option value="${m}" ${sh.meal === m ? "selected" : ""}>${cap(m)}</option>`).join("")}</select></label>
      <button class="btn primary full big" data-action="logFood">${sh.editId ? "Save" : "Add"}</button>
      ${sh.editId ? `<button class="btn danger ghost full" data-action="deleteFood" data-id="${sh.editId}">Delete entry</button>` : ""}`;
  }
  _nutriHtml(p) {
    return `<div><div class="big">${r0(p.kcal)}</div><div class="muted small">kcal</div></div>
      <div><div class="big">${r1(p.protein)}</div><div class="muted small">protein</div></div>
      <div><div class="big">${r1(p.carbs)}</div><div class="muted small">carbs</div></div>
      <div><div class="big">${r1(p.fat)}</div><div class="muted small">fat</div></div>`;
  }

  /* ============================================================ PROFILE */
  _viewProfile() {
    const o = this._s.overview;
    if (!o) return `<div class="empty">Loading…</div>`;
    const u = this._units, p = o.profile, e = o.energy || {};
    const weights = (this._s.vitals.weight || []).slice().reverse();
    const cur = o.latest.weight?.value;
    const start = weights[0]?.value ?? cur;
    const target = p.target_weight_kg;
    let pct = 0;
    if (start != null && target != null && start !== target) pct = Math.max(0, Math.min(100, ((start - cur) / (start - target)) * 100));
    const pts = weights.map((v) => ({ x: new Date(v.recorded_at).getTime(), y: u.wOut(v.value) }));
    const goalWord = { lose: "Lose weight", gain: "Gain weight", maintain: "Maintain" }[e.goal] || "";
    const tiles = Object.entries(VITALS).map(([k, v]) => {
      const l = o.latest[k];
      let val = "–";
      if (l) {
        if (k === "weight") val = `${r1(u.wOut(l.value))} ${u.w}`;
        else if (k === "height") val = u.h(l.value);
        else if (k === "blood_pressure") val = `${r0(l.systolic)}/${r0(l.diastolic)}`;
        else val = `${r1(l.value)} ${v.unit}`;
      }
      return `<button class="tile" data-action="openVital" data-type="${k}">${icon(v.icon)}<div class="muted small">${v.label}</div><div class="tileval">${val}</div>
        <div class="muted xsmall">${l ? fmtDate(l.recorded_at, { month: "short", day: "numeric" }) : "Tap to log"}</div></button>`;
    }).join("");
    return `<div class="card">
        <div class="row between"><div><h2>${esc(p.name)}</h2><div class="muted small">${goalWord}${o.workouts_7d ? ` · ${o.workouts_7d} workout${o.workouts_7d > 1 ? "s" : ""} this week` : ""}</div></div>
        <button class="iconbtn" data-action="editProfile" aria-label="Edit profile">${icon("mdi:pencil")}</button></div>
        <div class="weights"><div><div class="muted small">Current</div><div class="big">${r1(u.wOut(cur))} <small>${u.w}</small></div></div>
          ${icon("mdi:arrow-right", "muted")}
          <div><div class="muted small">Target</div><div class="big">${r1(u.wOut(target))} <small>${u.w}</small></div></div></div>
        ${e.goal !== "maintain" ? `<div class="bar"><div class="fill p" style="width:${pct}%"></div></div><div class="muted small">${r0(pct)}% of the way · ${r1(Math.abs(u.wOut(cur - target)))} ${u.w} to go</div>` : ""}
        ${pts.length > 1 ? lineChart(pts) : `<p class="muted small">Log your weight regularly to see your trend.</p>`}
        <button class="btn primary full" data-action="openVital" data-type="weight">${icon("mdi:scale-bathroom")} Log weight</button>
      </div>
      <h3 class="section">Health stats</h3>
      <div class="tiles">${tiles}</div>
      <h3 class="section">Energy</h3>
      <div class="card energy">
        <div class="egrid">
          <div><div class="muted small">BMR</div><div class="big">${r0(e.bmr)}</div></div>
          <div><div class="muted small">Maintenance</div><div class="big">${r0(e.maintenance)}</div></div>
          <div><div class="muted small">Daily target</div><div class="big accent">${r0(e.target)}</div></div>
        </div>
        <div class="muted small">${esc(e.formula || "")} · ${esc(e.activity_label || "")} (×${e.activity_multiplier ?? "–"}) · ${r0(p.daily_steps)} steps/day · ${p.lifting_days} lifting day${p.lifting_days === 1 ? "" : "s"}/wk</div>
        ${e.daily_adjustment ? `<div class="muted small">${e.daily_adjustment < 0 ? "Deficit" : "Surplus"} of ${r0(Math.abs(e.daily_adjustment))} kcal/day for ${r1(u.wOut(p.goal_rate_kg_week, 2))} ${u.w}/week${e.target_floored ? " (raised to a safe minimum)" : ""}</div>` : ""}
        <div class="egrid">
          <div><div class="muted small">Protein</div><b>${r0(e.protein_g)} g</b></div>
          <div><div class="muted small">Carbs</div><b>${r0(e.carbs_g)} g</b></div>
          <div><div class="muted small">Fat</div><b>${r0(e.fat_g)} g</b></div>
        </div>
      </div>`;
  }

  async _sheetVitalData(type) {
    const list = await this.ws("vitals/list", { vital_type: type, limit: 30 });
    return { kind: "vital", type, list };
  }

  _sheetVital(sh) {
    const u = this._units, v = VITALS[sh.type];
    let fields;
    if (sh.type === "weight") fields = `<label>Weight (${u.w})<input data-v="value" inputmode="decimal" autofocus></label>`;
    else if (sh.type === "height") fields = u.imp
      ? `<div class="grid2"><label>Feet<input data-v="ft" inputmode="numeric"></label><label>Inches<input data-v="in" inputmode="decimal"></label></div>`
      : `<label>Height (cm)<input data-v="value" inputmode="decimal"></label>`;
    else if (sh.type === "blood_pressure") fields = `<div class="grid2"><label>Systolic<input data-v="systolic" inputmode="numeric"></label><label>Diastolic<input data-v="diastolic" inputmode="numeric"></label></div>`;
    else fields = `<label>${v.label} (${v.unit})<input data-v="value" inputmode="decimal"></label>`;
    const fmt = (x) => sh.type === "weight" ? `${r1(u.wOut(x.value))} ${u.w}` : sh.type === "height" ? u.h(x.value)
      : sh.type === "blood_pressure" ? `${r0(x.systolic)}/${r0(x.diastolic)} mmHg` : `${r1(x.value)} ${v.unit}`;
    const hist = sh.list.map((x) => `<div class="histrow row between"><div><div>${fmt(x)}</div><div class="muted small">${fmtDate(x.recorded_at)} · ${fmtTime(x.recorded_at)}${x.note ? ` · ${esc(x.note)}` : ""}</div></div>
      <button class="iconbtn sm" data-action="deleteVital" data-id="${x.id}" aria-label="Delete">${icon("mdi:delete-outline")}</button></div>`).join("");
    return `<h2>${icon(v.icon)} ${v.label}</h2>
      <div class="form">${fields}<label>When<input type="datetime-local" data-v="when" value="${toLocalInput()}"></label>
      <label>Note (optional)<input data-v="note"></label>
      <button class="btn primary full" data-action="saveVital">Save</button></div>
      ${hist ? `<h3>History</h3>${hist}` : ""}`;
  }

  _sheetProfile() {
    const p = this._s.overview.profile, u = this._units;
    const hcm = this._s.overview.latest.height?.value ?? p.height_cm;
    const tin = hcm / 2.54;
    return `<h2>Edit profile</h2><div class="form">
      <label>Name<input data-p="name" value="${esc(p.name)}"></label>
      <div class="grid2">
        <label>Units<select data-p="units"><option value="imperial" ${u.imp ? "selected" : ""}>Imperial</option><option value="metric" ${!u.imp ? "selected" : ""}>Metric</option></select></label>
        <label>Sex<select data-p="sex"><option value="male" ${p.sex === "male" ? "selected" : ""}>Male</option><option value="female" ${p.sex === "female" ? "selected" : ""}>Female</option></select></label>
        <label>Age<input data-p="age" inputmode="numeric" value="${this._s.overview.age}"></label>
        <label>Target weight (${u.w})<input data-p="target" inputmode="decimal" value="${u.wOut(p.target_weight_kg)}"></label>
      </div>
      ${u.imp ? `<div class="grid2"><label>Height (ft)<input data-p="ft" inputmode="numeric" value="${Math.floor(tin / 12)}"></label><label>Height (in)<input data-p="in" inputmode="decimal" value="${Math.round((tin % 12) * 2) / 2}"></label></div>`
        : `<label>Height (cm)<input data-p="cm" inputmode="decimal" value="${r1(hcm)}"></label>`}
      <div class="grid2">
        <label>Avg steps / day<input data-p="steps" inputmode="numeric" value="${p.daily_steps}"></label>
        <label>Lifting days / week<input data-p="lift" inputmode="numeric" value="${p.lifting_days}"></label>
      </div>
      <label>Goal pace (${u.w}/week)<input data-p="rate" inputmode="decimal" value="${u.wOut(p.goal_rate_kg_week, 2)}"></label>
      <p class="muted small">Current weight and body fat come from your latest logged health stats.</p>
      <button class="btn primary full" data-action="saveProfile">Save</button></div>`;
  }

  /* ======================================================= template edit */
  _sheetTemplate(sh) {
    const t = sh.tpl;
    const exs = t.exercises.map((e, i) => {
      const working = e.sets.filter((x) => x.type !== "warmup").length;
      const warm = e.sets.length - working;
      return `<div class="tplex"><div class="row between"><b>${esc(this._exName(e.exercise_id))}</b>
        <button class="iconbtn sm" data-action="tplRemove" data-i="${i}" aria-label="Remove">${icon("mdi:close")}</button></div>
        <div class="row tplrow">
          <span class="muted small">Warm-up</span><button class="iconbtn sm" data-action="tplSets" data-i="${i}" data-w="1" data-d="-1">${icon("mdi:minus")}</button><b>${warm}</b><button class="iconbtn sm" data-action="tplSets" data-i="${i}" data-w="1" data-d="1">${icon("mdi:plus")}</button>
          <span class="muted small">Sets</span><button class="iconbtn sm" data-action="tplSets" data-i="${i}" data-d="-1">${icon("mdi:minus")}</button><b>${working}</b><button class="iconbtn sm" data-action="tplSets" data-i="${i}" data-d="1">${icon("mdi:plus")}</button>
          <label class="inline small">Reps <input class="cell" inputmode="numeric" data-tplreps="${i}" value="${e.sets.find((x) => x.type !== "warmup")?.reps ?? ""}"></label>
        </div></div>`;
    }).join("");
    return `<h2>${t.id ? "Edit" : "New"} template</h2><div class="form">
      <label>Name<input data-tpl="name" value="${esc(t.name || "")}" placeholder="e.g. Push Day"></label></div>
      ${exs || `<p class="muted">No exercises yet.</p>`}
      <button class="btn ghost full" data-action="tplAddExercise">${icon("mdi:plus")} Add exercise</button>
      <button class="btn primary full" data-action="tplSave">Save template</button>`;
  }

  _sheetPicker(sh) {
    const q = (sh.query || "").toLowerCase();
    const muscles = [...new Set(this._s.exercises.map((e) => e.muscle))];
    const list = this._s.exercises.filter((e) => (!sh.muscle || e.muscle === sh.muscle) && (!q || e.name.toLowerCase().includes(q)));
    return `<h2>Add exercise</h2>
      <div class="searchbox">${icon("mdi:magnify")}<input id="exq" type="search" placeholder="Search exercises" value="${esc(sh.query || "")}" data-input="exSearch" autocomplete="off"></div>
      <div class="chips"><button class="chip ${!sh.muscle ? "on" : ""}" data-action="exMuscle" data-m="">All</button>${muscles.map((m) => `<button class="chip ${sh.muscle === m ? "on" : ""}" data-action="exMuscle" data-m="${esc(m)}">${esc(m)}</button>`).join("")}</div>
      <div id="exlist">${list.map((e) => `<button class="foodrow" data-action="pickExercise" data-id="${e.id}"><div><div>${esc(e.name)}</div><div class="muted small">${esc(e.muscle)} · ${esc(e.equipment)}</div></div>${icon("mdi:plus")}</button>`).join("")}</div>
      <details class="newex"><summary>Create custom exercise</summary><div class="form">
        <label>Name<input data-nx="name" value="${esc(sh.query || "")}"></label>
        <div class="grid2"><label>Muscle group<input data-nx="muscle" placeholder="e.g. Chest"></label>
        <label>Equipment<input data-nx="equipment" placeholder="e.g. Cable"></label></div>
        <label>Tracks<select data-nx="kind"><option value="weight_reps">Weight & reps</option><option value="bodyweight_reps">Bodyweight reps</option><option value="duration">Time</option><option value="distance">Distance & time</option></select></label>
        <button class="btn primary full" data-action="createExercise">Create & add</button></div></details>`;
  }

  /* ============================================================== sheets */
  _openSheet(sh) { this._s.sheets.push(sh); this._renderSheet(); }
  _closeSheet() { this._s.sheets.pop(); this._renderSheet(); }
  get _sheet() { return this._s.sheets[this._s.sheets.length - 1]; }

  _renderSheet() {
    const el = this.shadowRoot.getElementById("sheet");
    if (!el) return;
    const sh = this._sheet;
    if (!sh) { el.innerHTML = ""; return; }
    let body = "";
    switch (sh.kind) {
      case "html": body = sh.html; break;
      case "addFood": body = this._sheetAddFood(sh); break;
      case "portion": body = this._sheetPortion(sh); break;
      case "vital": body = this._sheetVital(sh); break;
      case "profile": body = this._sheetProfile(); break;
      case "template": body = this._sheetTemplate(sh); break;
      case "picker": body = this._sheetPicker(sh); break;
      case "confirm": body = `<h2>${esc(sh.title)}</h2><p>${esc(sh.text)}</p><div class="actions"><button class="btn" data-action="confirmNo">Cancel</button><button class="btn ${sh.danger ? "danger" : "primary"}" data-action="confirmYes">${esc(sh.ok)}</button></div>`; break;
    }
    const prevScroll = el.querySelector(".sheetbody")?.scrollTop || 0;
    el.innerHTML = `<div class="scrim" data-action="closeSheet"></div>
      <div class="sheet" role="dialog"><div class="grab"></div><button class="iconbtn close" data-action="closeSheet" aria-label="Close">${icon("mdi:close")}</button>
      <div class="sheetbody">${body}</div></div>`;
    el.querySelector(".sheetbody").scrollTop = prevScroll;
  }

  _confirm(title, text, ok = "OK", danger = false) {
    return new Promise((resolve) => this._openSheet({ kind: "confirm", title, text, ok, danger, resolve }));
  }

  _toast(msg, err = false) {
    const el = this.shadowRoot.getElementById("toast");
    if (!el) return;
    el.innerHTML = `<div class="toast ${err ? "err" : ""}">${esc(msg)}</div>`;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (el.innerHTML = ""), 2800);
  }

  _exName(id) { return this._exMap?.[id]?.name || id; }

  /* ============================================================== events */
  _onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    this._act(el.dataset.action, el, e);
  }

  async _act(action, el, ev) {
    const s = this._s, d = el.dataset;
    try {
      switch (action) {
        case "menu": this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true })); break;
        case "tab":
          s.tab = d.tab; localStorage.setItem("ha-health-tab", s.tab); s.sheets = [];
          this._render(); await this._loadTab(); this._render();
          this.shadowRoot.getElementById("content").scrollTop = 0;
          break;
        case "closeSheet": { const sh = this._sheet; if (sh?.kind === "confirm") sh.resolve(false); this._closeSheet(); break; }
        case "confirmYes": { const sh = this._sheet; this._closeSheet(); sh.resolve(true); break; }
        case "confirmNo": { const sh = this._sheet; this._closeSheet(); sh.resolve(false); break; }

        /* history */
        case "historyMode": s.historyMode = d.mode; this._render(); await this._loadTab(); this._render(); break;
        case "moreWorkouts": {
          const res = await this.ws("workout/list", { offset: s.workouts.length, limit: 20 });
          s.workouts = s.workouts.concat(res.items); s.workoutsTotal = res.total; this._render(); break;
        }
        case "openWorkout": {
          const w = s.workouts.find((x) => x.id === d.id);
          this._openSheet({ kind: "html", html: this._sheetWorkout(w) }); break;
        }
        case "openExercise": this._openSheet({ kind: "html", html: await this._sheetExercise(d.id) }); break;
        case "deleteWorkout":
          if (!(await this._confirm("Delete workout?", "This can't be undone.", "Delete", true))) break;
          await this.ws("workout/delete", { workout_id: d.id });
          s.workouts = s.workouts.filter((w) => w.id !== d.id); s.workoutsTotal--; s.records = null;
          s.sheets = []; this._render(); this._toast("Workout deleted"); break;
        case "templateFromWorkout": {
          const t = await this.ws("templates/from_workout", { workout_id: d.id });
          s.templates = await this.ws("templates/list"); this._closeSheet(); this._toast(`Saved template “${t.name}”`); break;
        }

        /* workout */
        case "startWorkout": {
          s.active = await this.ws("workout/start", d.template ? { template_id: d.template } : {});
          await this._loadLast(s.active.exercises.map((x) => x.exercise_id));
          this._render(); break;
        }
        case "finishWorkout": {
          await this._flushWorkout();
          const incomplete = s.active.exercises.some((x) => x.sets.some((y) => !y.completed));
          const ok = await this._confirm("Finish workout?", incomplete ? "Sets that aren't checked off will be dropped." : "Nice work!", "Finish");
          if (!ok) break;
          const w = await this.ws("workout/finish");
          s.active = null; s.rest = null; s.workouts = null; s.records = null; s.last = {};
          await this._refreshOverview();
          s.tab = "history"; localStorage.setItem("ha-health-tab", "history");
          await this._loadTab(); this._render();
          this._openSheet({ kind: "html", html: this._sheetWorkout(w) });
          this._toast(prCount(w) ? `Workout saved — ${prCount(w)} new PR${prCount(w) > 1 ? "s" : ""}! 🏆` : "Workout saved");
          break;
        }
        case "discardWorkout":
          if (!(await this._confirm("Discard workout?", "Everything logged in this workout will be lost.", "Discard", true))) break;
          clearTimeout(this._saveTimer); this._saveTimer = null;
          await this.ws("workout/discard"); s.active = null; s.rest = null; this._render(); break;
        case "addExercise":
          this._openSheet({ kind: "picker", query: "", muscle: "", onPick: async (id) => {
            s.active.exercises.push({ id: rid(), exercise_id: id, notes: "", sets: [blankSet(), blankSet(), blankSet()] });
            await this._loadLast([id]);
            this._queueWorkoutSave(); this._render();
          } });
          break;
        case "pickExercise": { const sh = this._sheet; this._closeSheet(); await sh.onPick(d.id); break; }
        case "exMuscle": this._sheet.muscle = d.m; this._renderSheet(); break;
        case "createExercise": {
          const get = (k) => this.shadowRoot.querySelector(`[data-nx="${k}"]`)?.value;
          const ex = await this.ws("exercises/create", { exercise: { name: get("name"), muscle: get("muscle"), equipment: get("equipment"), kind: get("kind") } });
          s.exercises.push(ex); this._exMap[ex.id] = ex;
          const sh = this._sheet; this._closeSheet(); await sh.onPick(ex.id); break;
        }
        case "removeExercise":
          if (!(await this._confirm("Remove exercise?", `Remove ${this._exName(s.active.exercises[d.e].exercise_id)} and its sets?`, "Remove", true))) break;
          s.active.exercises.splice(+d.e, 1); this._queueWorkoutSave(); this._render(); break;
        case "addSet": {
          const ex = s.active.exercises[+d.e];
          const prev = ex.sets[ex.sets.length - 1];
          ex.sets.push(blankSet(prev));
          this._queueWorkoutSave(); this._render(); break;
        }
        case "removeSet": s.active.exercises[+d.e].sets.splice(+d.s, 1); this._queueWorkoutSave(); this._render(); break;
        case "cycleType": {
          const x = s.active.exercises[+d.e].sets[+d.s];
          x.type = SET_TYPES[(SET_TYPES.indexOf(x.type) + 1) % SET_TYPES.length];
          this._queueWorkoutSave(); this._render(); break;
        }
        case "usePrev": {
          const ex = s.active.exercises[+d.e];
          const prev = prevFor(s.last[ex.exercise_id], ex.sets, +d.s);
          if (!prev) break;
          Object.assign(ex.sets[+d.s], { weight: prev.weight, reps: prev.reps, duration_s: prev.duration_s, distance_m: prev.distance_m });
          this._queueWorkoutSave(); this._render(); break;
        }
        case "toggleSet": {
          const ex = s.active.exercises[+d.e];
          const x = ex.sets[+d.s];
          const prev = prevFor(s.last[ex.exercise_id], ex.sets, +d.s);
          // Checking an empty row uses the placeholder (last time's numbers), like most lifting apps.
          if (!x.completed && prev) {
            if (x.weight == null && prev.weight != null) x.weight = prev.weight;
            if (x.reps == null && prev.reps != null) x.reps = prev.reps;
            if (x.duration_s == null && prev.duration_s != null) x.duration_s = prev.duration_s;
            if (x.distance_m == null && prev.distance_m != null) x.distance_m = prev.distance_m;
          }
          x.completed = !x.completed;
          if (x.completed && x.type !== "warmup") s.rest = { endsAt: Date.now() + 90000, total: 90 };
          this._queueWorkoutSave(); this._render(); break;
        }
        case "restAdj": if (s.rest) { s.rest.endsAt += +d.d * 1000; s.rest.total = Math.max(s.rest.total + +d.d, 1); } this._renderRest(); break;
        case "restSkip": s.rest = null; this._renderRest(); break;

        /* templates */
        case "newTemplate": this._openSheet({ kind: "template", tpl: { name: "", exercises: [] } }); break;
        case "editTemplate": this._openSheet({ kind: "template", tpl: structuredClone(s.templates.find((t) => t.id === d.id)) }); break;
        case "deleteTemplate":
          if (!(await this._confirm("Delete template?", "Past workouts aren't affected.", "Delete", true))) break;
          await this.ws("templates/delete", { template_id: d.id }); s.templates = await this.ws("templates/list"); this._render(); break;
        case "tplAddExercise": {
          const tsh = this._sheet;
          this._openSheet({ kind: "picker", query: "", muscle: "", onPick: (id) => {
            tsh.tpl.exercises.push({ exercise_id: id, sets: [1, 2, 3].map(() => ({ type: "working", reps: 10, weight: null })) });
            this._renderSheet();
          } });
          break;
        }
        case "tplRemove": this._sheet.tpl.exercises.splice(+d.i, 1); this._renderSheet(); break;
        case "tplSets": {
          const ex = this._sheet.tpl.exercises[+d.i];
          const warm = !!d.w;
          if (+d.d > 0) {
            const reps = ex.sets.find((x) => x.type !== "warmup")?.reps ?? 10;
            if (warm) ex.sets.unshift({ type: "warmup", reps: 10, weight: null });
            else ex.sets.push({ type: "working", reps, weight: null });
          } else {
            const idx = warm ? ex.sets.findIndex((x) => x.type === "warmup") : ex.sets.map((x) => x.type !== "warmup").lastIndexOf(true);
            if (idx >= 0) ex.sets.splice(idx, 1);
          }
          this._renderSheet(); break;
        }
        case "tplSave": {
          const t = this._sheet.tpl;
          t.name = this.shadowRoot.querySelector('[data-tpl="name"]').value;
          await this.ws("templates/save", { template: t });
          s.templates = await this.ws("templates/list"); this._closeSheet(); this._render(); this._toast("Template saved"); break;
        }

        /* nutrition */
        case "day": s.day = addDays(s.day, +d.d); s.food = await this.ws("food/day", { date: s.day }); this._render(); break;
        case "dayToday": s.day = localDate(); s.food = await this.ws("food/day", { date: s.day }); this._render(); break;
        case "addFood": {
          const sh = { kind: "addFood", meal: d.meal, mode: "search", query: "" };
          this._openSheet(sh);
          const rec = await this.ws("food/recent");
          Object.assign(sh, rec); if (this._sheet === sh) this._renderSheet();
          break;
        }
        case "foodMode": this._sheet.mode = d.mode; this._renderSheet(); break;
        case "pickFood": {
          const sh = this._sheet;
          const pool = { recent: sh.recent, custom: sh.custom, rcustom: sh.results?.custom, results: sh.results?.results }[d.src];
          const food = pool[+d.i];
          const amount = d.src === "recent" && food.last_amount ? food.last_amount : 1;
          const unit = d.src === "recent" && food.last_unit ? food.last_unit : "serving";
          this._openSheet({ kind: "portion", food, amount, unit, meal: sh.meal });
          break;
        }
        case "logFood": {
          const sh = this._sheet, f = sh.food, p = portion(f, sh.amount, sh.unit);
          if (sh.editId) {
            await this.ws("food/update", { entry_id: sh.editId, changes: { amount: Number(sh.amount), unit: sh.unit, meal: sh.meal, ...p } });
          } else {
            await this.ws("food/log", { entry: {
              date: s.day, meal: sh.meal, food_id: f.food_id || f.id, name: f.name, brand: f.brand,
              amount: Number(sh.amount), unit: sh.unit, ...p,
              per_100g: f.per_100g, per_serving: f.per_serving, serving_qty: f.serving_qty, serving_unit: f.serving_unit, serving_g: f.serving_g,
            } });
          }
          s.sheets = []; s.food = await this.ws("food/day", { date: s.day }); this._render();
          this._toast(sh.editId ? "Entry updated" : `Added ${f.name}`); break;
        }
        case "editFood": {
          const e = s.food.entries.find((x) => x.id === d.id);
          // Rebuild a per-unit basis from the logged numbers so the amount can be rescaled.
          const per = {}; ["kcal", "protein", "fat", "carbs", "fiber"].forEach((k) => (per[k] = (e[k] || 0) / (e.amount || 1)));
          const food = { name: e.name, brand: e.brand, food_id: e.food_id };
          if (e.unit === "g") food.per_100g = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v * 100]));
          else if (e.unit === "oz") food.per_100g = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, (v / OZ_G) * 100]));
          else { food.per_serving = per; food.serving_g = e.grams && e.amount ? e.grams / e.amount : null; }
          const unit = e.unit === "quick" ? "serving" : e.unit;
          this._openSheet({ kind: "portion", food, amount: e.unit === "oz" ? e.amount : e.amount, unit: e.unit === "oz" ? "oz" : unit, meal: e.meal, editId: e.id });
          break;
        }
        case "deleteFood":
          await this.ws("food/delete", { entry_id: d.id });
          s.sheets = []; s.food = await this.ws("food/day", { date: s.day }); this._render(); this._toast("Entry deleted"); break;
        case "quickAdd": {
          const get = (k) => this.shadowRoot.querySelector(`[data-q="${k}"]`)?.value;
          if (!num(get("kcal")) && !num(get("protein")) && !num(get("carbs")) && !num(get("fat"))) { this._toast("Enter at least calories", true); break; }
          await this.ws("food/log", { entry: { date: s.day, meal: this._sheet.meal, name: get("name") || "Quick add", amount: 1, unit: "quick",
            kcal: num(get("kcal")) || 0, protein: num(get("protein")) || 0, carbs: num(get("carbs")) || 0, fat: num(get("fat")) || 0, remember: false } });
          s.sheets = []; s.food = await this.ws("food/day", { date: s.day }); this._render(); this._toast("Added"); break;
        }
        case "createCustomFood": {
          const get = (k) => this.shadowRoot.querySelector(`[data-c="${k}"]`)?.value;
          const food = await this.ws("food/custom/create", { food: {
            name: get("name"), brand: get("brand") || null, serving_qty: num(get("serving_qty")) || 1, serving_unit: get("serving_unit") || "serving",
            serving_g: num(get("serving_g")), kcal: num(get("kcal")) || 0, protein: num(get("protein")) || 0, carbs: num(get("carbs")) || 0, fat: num(get("fat")) || 0,
          } });
          const sh = this._sheet; sh.custom = [food, ...(sh.custom || [])]; sh.mode = "search";
          this._openSheet({ kind: "portion", food, amount: 1, unit: "serving", meal: sh.meal });
          break;
        }

        /* profile */
        case "openVital": this._openSheet(await this._sheetVitalData(d.type)); break;
        case "saveVital": {
          const sh = this._sheet, u = this._units;
          const get = (k) => this.shadowRoot.querySelector(`[data-v="${k}"]`)?.value;
          const values = {};
          if (sh.type === "weight") values.value = u.wIn(get("value"));
          else if (sh.type === "height") values.value = u.imp ? ((num(get("ft")) || 0) * 12 + (num(get("in")) || 0)) * 2.54 : num(get("value"));
          else if (sh.type === "blood_pressure") { values.systolic = num(get("systolic")); values.diastolic = num(get("diastolic")); }
          else values.value = num(get("value"));
          if (Object.values(values).some((v) => v == null || isNaN(v) || v === 0)) { this._toast("Please enter a value", true); break; }
          const when = get("when");
          await this.ws("vitals/log", { vital_type: sh.type, values, recorded_at: when ? new Date(when).toISOString() : undefined, note: get("note") || null });
          s.sheets = []; await this._loadTab(); this._render(); this._toast(`${VITALS[sh.type].label} saved`); break;
        }
        case "deleteVital": {
          if (!(await this._confirm("Delete entry?", "This health stat entry will be removed.", "Delete", true))) break;
          await this.ws("vitals/delete", { vital_id: d.id });
          const sh = this._sheet; sh.list = sh.list.filter((x) => x.id !== d.id);
          await this._loadTab(); this._render(); break;
        }
        case "editProfile": this._openSheet({ kind: "profile" }); break;
        case "saveProfile": {
          const get = (k) => this.shadowRoot.querySelector(`[data-p="${k}"]`)?.value;
          const units = get("units"), nu = new Units(this._units.imp ? "imperial" : "metric");
          const changes = {
            name: get("name"), units, sex: get("sex"), age: num(get("age")),
            target_weight_kg: nu.wIn(get("target")), daily_steps: num(get("steps")), lifting_days: num(get("lift")),
            goal_rate_kg_week: nu.wIn(get("rate")),
          };
          const curH = this._s.overview.latest.height?.value ?? this._s.overview.profile.height_cm;
          const h = nu.imp ? ((num(get("ft")) || 0) * 12 + (num(get("in")) || 0)) * 2.54 : num(get("cm"));
          if (h && Math.abs(h - curH) > 0.6) changes.height_cm = Math.round(h * 10) / 10;
          await this.ws("profile/update", { changes });
          s.sheets = []; await this._loadAll(); this._render(); this._toast("Profile saved"); break;
        }
      }
    } catch (err) {
      console.error(err);
      this._toast(err.message || String(err), true);
    }
  }

  _onInput(e) {
    const t = e.target, d = t.dataset, s = this._s;
    if (d.set !== undefined && s.active) {
      const x = s.active.exercises[+d.e].sets[+d.s];
      const v = t.value;
      const u = this._units;
      if (d.set === "weight") x.weight = u.wIn(v);
      else if (d.set === "reps") x.reps = v === "" ? null : parseInt(v, 10);
      else if (d.set === "duration_s") x.duration_s = v === "" ? null : parseInt(v, 10);
      else if (d.set === "minutes") x.duration_s = v === "" ? null : Math.round(Number(v) * 60);
      else if (d.set === "distance") x.distance_m = u.dIn(v);
      this._queueWorkoutSave();
    } else if (d.exnote !== undefined && s.active) {
      s.active.exercises[+d.exnote].notes = t.value; this._queueWorkoutSave();
    } else if (d.wfield && s.active) {
      s.active[d.wfield] = t.value; this._queueWorkoutSave();
    } else if (d.input === "foodSearch") {
      const sh = this._sheet; sh.query = t.value;
      clearTimeout(this._searchT);
      if (!sh.query.trim()) { sh.results = null; this._updateFoodResults(); return; }
      sh.searching = true;
      this._searchT = setTimeout(async () => {
        const q = sh.query;
        try {
          const res = await this.ws("food/search", { query: q, limit: 30 });
          if (sh.query === q) { sh.results = res; sh.searching = false; this._updateFoodResults(); }
        } catch (err) { this._toast(err.message, true); }
      }, 250);
    } else if (d.input === "portionAmount") {
      const sh = this._sheet; sh.amount = t.value;
      this.shadowRoot.getElementById("nutri").innerHTML = this._nutriHtml(portion(sh.food, sh.amount, sh.unit));
    } else if (d.input === "exSearch") {
      const sh = this._sheet; sh.query = t.value;
      const pos = t.selectionStart;
      this._renderSheet();
      const inp = this.shadowRoot.getElementById("exq"); inp.focus(); inp.setSelectionRange(pos, pos);
    } else if (d.tplreps !== undefined) {
      const ex = this._sheet.tpl.exercises[+d.tplreps];
      ex.sets.forEach((x) => { if (x.type !== "warmup") x.reps = num(t.value); });
    }
  }

  _updateFoodResults() {
    const el = this.shadowRoot.getElementById("foodresults");
    if (el) el.innerHTML = this._foodResults(this._sheet);
  }

  async _onChange(e) {
    const t = e.target, d = t.dataset, s = this._s;
    if (d.set === "rpe" && s.active) { s.active.exercises[+d.e].sets[+d.s].rpe = num(t.value); this._queueWorkoutSave(); }
    else if (d.change === "portionUnit") {
      const sh = this._sheet, old = sh.unit, f = sh.food;
      // Convert the amount so the portion stays the same size when switching units.
      const g = portion(f, sh.amount, old).grams;
      if (g) sh.amount = t.value === "g" ? Math.round(g) : t.value === "oz" ? Math.round((g / OZ_G) * 10) / 10 : Math.round((g / (f.serving_g || 100)) * 100) / 100;
      sh.unit = t.value; this._renderSheet();
    } else if (d.change === "portionMeal") this._sheet.meal = t.value;
    else if (d.change === "profile") {
      s.profileId = t.value; localStorage.setItem("ha-health-profile", t.value);
      s.workouts = null; s.records = null; s.last = {}; s.loading = true; this._render();
      await this._loadAll(); s.loading = false; this._render();
    }
  }
}

/* ------------------------------------------------------------ small utils */
/* Match a set to last time's set of the same kind (nth warm-up ↔ nth warm-up, nth work set ↔ nth work set). */
function prevFor(last, sets, i) {
  if (!last || !last.length) return null;
  const warm = (x) => x.type === "warmup";
  const isWarm = warm(sets[i]);
  const n = sets.slice(0, i).filter((x) => warm(x) === isWarm).length;
  return last.filter((x) => warm(x) === isWarm)[n] || null;
}
function prCount(w) { return new Set((w.prs || []).map((p) => p.exercise_id)).size; }
function rid() { return Math.random().toString(16).slice(2, 14); }
function blankSet(prev) {
  return { id: rid(), type: prev?.type === "warmup" ? "working" : prev?.type || "working", weight: prev?.weight ?? null, reps: prev?.reps ?? null, rpe: null, duration_s: prev?.duration_s ?? null, distance_m: prev?.distance_m ?? null, completed: false };
}

function ringChart(value, target) {
  const R = 52, C = 2 * Math.PI * R;
  const pct = target ? Math.min(1, value / target) : 0;
  const over = target && value > target;
  return `<svg viewBox="0 0 120 120" class="ring"><circle cx="60" cy="60" r="${R}" class="ringbg"/>
    <circle cx="60" cy="60" r="${R}" class="ringfg ${over ? "over" : ""}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" transform="rotate(-90 60 60)"/></svg>`;
}

function lineChart(pts) {
  const W = 320, H = 110, P = 8;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (x) => P + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * P);
  const sy = (y) => H - P - ((y - y0) / (y1 - y0 || 1)) * (H - 2 * P - 14);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
  const area = `${line}L${sx(x1).toFixed(1)},${H - P}L${sx(x0).toFixed(1)},${H - P}Z`;
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none">
    <path d="${area}" class="area"/><path d="${line}" class="line"/>
    <circle cx="${sx(last.x)}" cy="${sy(last.y)}" r="3.5" class="dot"/>
    <text x="${P}" y="12" class="lbl">${r1(y1)}</text><text x="${P}" y="${H - P - 2}" class="lbl">${r1(y0)}</text></svg>`;
}

/* ================================================================= styles */
const STYLES = `
:host { display:block; height:100%; --hp-accent: var(--primary-color, #03a9f4); --hp-good:#43a047; --hp-warn:#fb8c00; --hp-bad: var(--error-color, #db4437);
  --hp-card: var(--ha-card-background, var(--card-background-color, #fff)); --hp-text: var(--primary-text-color, #212121); --hp-muted: var(--secondary-text-color, #727272);
  --hp-line: var(--divider-color, rgba(0,0,0,.12)); --hp-bg: var(--primary-background-color, #f5f5f5); --hp-radius: var(--ha-card-border-radius, 14px);
  color: var(--hp-text); font-family: var(--paper-font-body1_-_font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif); -webkit-tap-highlight-color: transparent; }
* { box-sizing:border-box; }
button { font:inherit; color:inherit; background:none; border:0; cursor:pointer; padding:0; }
input, select, textarea { font:inherit; font-size:16px; color:var(--hp-text); background:var(--hp-bg); border:1px solid var(--hp-line); border-radius:10px; padding:10px 12px; width:100%; }
input:focus, select:focus, textarea:focus { outline:2px solid var(--hp-accent); outline-offset:-1px; }
ha-icon { --mdc-icon-size: 20px; display:inline-flex; vertical-align:middle; }
h2 { margin:0 0 4px; font-size:1.3rem; } h3 { margin:16px 0 8px; font-size:1rem; }
.app { display:flex; flex-direction:column; height:100%; background:var(--hp-bg); position:relative; overflow:hidden; }
.top { display:flex; align-items:center; gap:8px; padding:0 12px; height:56px; flex:0 0 auto; background:var(--app-header-background-color, var(--hp-card)); color:var(--app-header-text-color, var(--hp-text)); border-bottom:1px solid var(--hp-line); padding-top:env(safe-area-inset-top); box-sizing:content-box; }
.title { display:flex; align-items:center; gap:8px; font-size:1.25rem; font-weight:500; }
.brand { color:var(--hp-accent); --mdc-icon-size:24px; }
.narrow .brand { color: inherit; }
.spacer { flex:1; }
.profilesel { width:auto; padding:6px 10px; font-size:14px; background:transparent; color:inherit; }
main { flex:1 1 auto; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
.wrap { max-width:760px; margin:0 auto; padding:16px 12px 32px; }
.topnav { display:flex; gap:4px; margin-left:24px; }
.narrow .topnav { display:none; }
.wide .bottomnav { display:none; }
.topnav .navbtn { display:flex; align-items:center; gap:6px; padding:8px 14px; border-radius:20px; color:var(--hp-muted); }
.topnav .navbtn.on { background:color-mix(in srgb, var(--hp-accent) 15%, transparent); color:var(--hp-accent); }
.topnav .navbtn.center { background:var(--hp-accent); color:var(--text-primary-color, #fff); }
.bottomnav { flex:0 0 auto; display:grid; grid-template-columns:repeat(4,1fr); background:var(--hp-card); border-top:1px solid var(--hp-line); padding-bottom:env(safe-area-inset-bottom); }
.bottomnav .navbtn { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; padding:6px 0 8px; min-height:56px; color:var(--hp-muted); font-size:11px; }
.bottomnav .navbtn ha-icon { --mdc-icon-size:24px; }
.bottomnav .navbtn.on { color:var(--hp-accent); }
.bottomnav .navbtn.center .navicon { width:40px; height:40px; border-radius:50%; background:var(--hp-accent); color:var(--text-primary-color,#fff); display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px color-mix(in srgb, var(--hp-accent) 45%, transparent); }
.bottomnav .navbtn.center.on .navlabel { color:var(--hp-accent); font-weight:600; }
.card { display:block; width:100%; text-align:left; background:var(--hp-card); border-radius:var(--hp-radius); padding:14px; margin-bottom:12px; box-shadow:var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.08)); border:var(--ha-card-border-width,1px) solid var(--ha-card-border-color, var(--hp-line)); }
.card.empty { text-align:center; padding:28px 16px; } .card.empty p { color:var(--hp-muted); }
.card.warn { border-color:var(--hp-warn); color:var(--hp-warn); }
.empty { text-align:center; color:var(--hp-muted); padding:24px; }
.bigicon { --mdc-icon-size:44px; color:var(--hp-accent); margin-bottom:6px; }
.row { display:flex; align-items:center; gap:8px; } .between { justify-content:space-between; }
.muted { color:var(--hp-muted); } .small { font-size:.85rem; } .xsmall { font-size:.72rem; } .center { text-align:center; }
.big { font-size:1.5rem; font-weight:600; line-height:1.15; } .big small { font-size:.9rem; font-weight:400; color:var(--hp-muted); }
.accent { color:var(--hp-accent); }
.section { margin:18px 4px 8px; }
.btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:10px 16px; border-radius:22px; background:var(--hp-bg); border:1px solid var(--hp-line); font-weight:500; min-height:42px; }
.btn.primary { background:var(--hp-accent); color:var(--text-primary-color,#fff); border-color:transparent; }
.btn.danger { color:var(--hp-bad); } .btn.danger:not(.ghost) { border-color:var(--hp-bad); }
.btn.ghost { background:transparent; border-color:transparent; color:var(--hp-accent); } .btn.ghost.danger { color:var(--hp-bad); }
.btn.full { width:100%; margin-top:8px; } .btn.big { min-height:50px; font-size:1.05rem; } .btn.sm { padding:4px 10px; min-height:30px; font-size:.85rem; }
.iconbtn { width:40px; height:40px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; }
.iconbtn:hover { background:color-mix(in srgb, var(--hp-text) 8%, transparent); }
.iconbtn.sm { width:32px; height:32px; } .iconbtn.xs { width:26px; height:26px; } .iconbtn.xs ha-icon { --mdc-icon-size:16px; }
.iconbtn[disabled] { opacity:.3; }
.linklike { text-align:left; }
.seg { display:flex; background:var(--hp-card); border:1px solid var(--hp-line); border-radius:22px; padding:3px; margin-bottom:14px; }
.seg button { flex:1; padding:8px; border-radius:18px; color:var(--hp-muted); font-weight:500; }
.seg button.on { background:var(--hp-accent); color:var(--text-primary-color,#fff); }
.month { margin:18px 4px 8px; color:var(--hp-muted); font-weight:500; font-size:.9rem; text-transform:uppercase; letter-spacing:.04em; }
.stats { display:flex; gap:14px; margin:8px 0; font-size:.85rem; color:var(--hp-muted); flex-wrap:wrap; } .stats ha-icon { --mdc-icon-size:16px; }
.stats.big { font-size:1rem; color:var(--hp-text); margin:12px 0; }
.exline { display:flex; justify-content:space-between; font-size:.9rem; padding:2px 0; gap:8px; }
.badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:12px; font-size:.75rem; font-weight:600; }
.badge ha-icon { --mdc-icon-size:14px; } .gold { background:#fff3cd; color:#8a6d00; }
.recgrid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:10px; } .recval { font-weight:600; }
.prs { background:#fff8e1; color:#6d5300; border-radius:10px; padding:8px 12px; margin:8px 0; } .pr { padding:3px 0; } .pr ha-icon { --mdc-icon-size:16px; color:#f9a825; }
.detailex { margin:14px 0; }
.settable { width:100%; border-collapse:collapse; margin-top:6px; } .settable td { padding:5px 4px; border-top:1px solid var(--hp-line); }
.setbadge { display:inline-flex; width:26px; height:26px; border-radius:8px; align-items:center; justify-content:center; font-weight:700; font-size:.85rem; background:var(--hp-bg); }
.setbadge.warm { background:#fff3e0; color:#e65100; } .setbadge.fail { background:#ffebee; color:#c62828; } .setbadge.drop { background:#ede7f6; color:#4527a0; }
.actions { display:flex; gap:8px; justify-content:flex-end; margin-top:16px; flex-wrap:wrap; }
.histrow { padding:8px 0; border-top:1px solid var(--hp-line); }
.hero { text-align:center; padding:24px 16px; }
.tpl .btn { margin-top:10px; }
/* active workout */
.activehead { position:sticky; top:0; z-index:2; }
.wname { font-size:1.2rem; font-weight:600; background:transparent; border-color:transparent; padding:4px 0; margin-bottom:6px; }
.wname:focus { border-color:var(--hp-line); padding:4px 8px; }
.timer { font-variant-numeric:tabular-nums; font-size:1.1rem; color:var(--hp-accent); font-weight:600; }
.exercise .note { margin:6px 0 8px; padding:6px 10px; font-size:14px; background:transparent; border-style:dashed; }
.sethead, .setrow { display:grid; grid-template-columns: 28px minmax(40px,1fr) 62px 46px 46px 38px 22px; gap:5px; align-items:center; }
.sethead.k-duration, .setrow.k-duration { grid-template-columns: 28px minmax(40px,1fr) 100px 46px 38px 22px; }
.sethead { font-size:.72rem; color:var(--hp-muted); text-transform:uppercase; letter-spacing:.03em; padding:0 2px 4px; }
.setrow { padding:4px 2px; border-radius:10px; transition:background .15s; }
.setrow.done { background:color-mix(in srgb, var(--hp-good) 16%, transparent); }
.setrow .prev { font-size:.8rem; color:var(--hp-muted); text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cell { padding:8px 4px; text-align:center; border-radius:8px; min-width:0; }
select.cell { padding:8px 0; -webkit-appearance:none; appearance:none; text-align-last:center; }
.check { width:40px; height:36px; border-radius:8px; background:var(--hp-bg); border:1px solid var(--hp-line); display:flex; align-items:center; justify-content:center; color:var(--hp-muted); }
.check.on { background:var(--hp-good); color:#fff; border-color:transparent; }
.setrow .del { color:var(--hp-muted); }
.wnotes { margin-top:12px; min-height:70px; }
.restbar { position:relative; overflow:hidden; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 12px; background:var(--hp-card); border-top:1px solid var(--hp-line); font-weight:600; font-variant-numeric:tabular-nums; }
.restfill { position:absolute; inset:0 auto 0 0; background:color-mix(in srgb, var(--hp-accent) 18%, transparent); z-index:0; transition:width 1s linear; }
.restbar > * { position:relative; z-index:1; } .restbar > span { white-space:nowrap; }
/* nutrition */
.datenav { display:flex; align-items:center; justify-content:center; gap:16px; margin-bottom:10px; }
.summary { display:flex; gap:16px; align-items:center; }
.ringwrap { position:relative; width:128px; height:128px; flex:0 0 auto; }
.ring { width:100%; height:100%; } .ringbg { fill:none; stroke:var(--hp-bg); stroke-width:11; }
.ringfg { fill:none; stroke:var(--hp-accent); stroke-width:11; stroke-linecap:round; transition:stroke-dashoffset .4s; } .ringfg.over { stroke:var(--hp-bad); }
.ringtext { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.sumright { flex:1; display:flex; flex-direction:column; gap:6px; min-width:0; }
.bar { height:8px; background:var(--hp-bg); border-radius:4px; overflow:hidden; margin:4px 0; }
.fill { height:100%; border-radius:4px; background:var(--hp-accent); transition:width .4s; }
.fill.p { background:#e53935; } .fill.c { background:#fb8c00; } .fill.f { background:#8e24aa; }
.meal h3 { margin:0; }
.foodrow { display:flex; width:100%; justify-content:space-between; align-items:center; gap:10px; text-align:left; padding:10px 2px; border-top:1px solid var(--hp-line); }
.foodrow > div { min-width:0; } .foodrow .kcal { font-weight:600; white-space:nowrap; }
.searchbox { display:flex; align-items:center; gap:6px; background:var(--hp-bg); border:1px solid var(--hp-line); border-radius:12px; padding:0 10px; margin-bottom:8px; }
.searchbox input { border:0; background:transparent; padding:12px 4px; } .searchbox input:focus { outline:none; }
.portion { display:flex; gap:8px; margin:14px 0; } .portion .amount { width:110px; flex:0 0 auto; font-size:1.2rem; text-align:center; font-weight:600; }
.nutri { display:grid; grid-template-columns:repeat(4,1fr); text-align:center; background:var(--hp-bg); border-radius:12px; padding:12px 4px; margin-bottom:12px; }
.nutri .big { font-size:1.2rem; }
.form { display:flex; flex-direction:column; gap:10px; margin:10px 0; }
.form label, label.inline { display:flex; flex-direction:column; gap:4px; font-size:.85rem; color:var(--hp-muted); }
label.inline { flex-direction:row; align-items:center; gap:8px; } label.inline select, label.inline input { width:auto; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
/* profile */
.weights { display:flex; align-items:center; justify-content:space-around; margin:14px 0 8px; text-align:center; }
.chart { width:100%; height:110px; margin:10px 0 4px; } .chart .line { fill:none; stroke:var(--hp-accent); stroke-width:2.5; vector-effect:non-scaling-stroke; }
.chart .area { fill:color-mix(in srgb, var(--hp-accent) 14%, transparent); } .chart .dot { fill:var(--hp-accent); } .chart .lbl { font-size:10px; fill:var(--hp-muted); }
.tiles { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px,1fr)); gap:10px; }
.tile { background:var(--hp-card); border-radius:var(--hp-radius); padding:12px; text-align:left; border:1px solid var(--hp-line); display:flex; flex-direction:column; gap:2px; }
.tile ha-icon { color:var(--hp-accent); margin-bottom:4px; } .tileval { font-size:1.15rem; font-weight:600; }
.egrid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:6px 0 10px; }
/* template / picker */
.tplex { border-top:1px solid var(--hp-line); padding:10px 0; } .tplrow { flex-wrap:wrap; margin-top:6px; } .tplrow .cell { width:56px; }
.chips { display:flex; gap:6px; overflow-x:auto; padding-bottom:6px; margin-bottom:4px; scrollbar-width:none; }
.chip { padding:6px 12px; border-radius:16px; border:1px solid var(--hp-line); white-space:nowrap; font-size:.85rem; }
.chip.on { background:var(--hp-accent); color:var(--text-primary-color,#fff); border-color:transparent; }
.newex { margin-top:12px; } .newex summary { color:var(--hp-accent); cursor:pointer; padding:8px 0; }
/* sheet */
.scrim { position:absolute; inset:0; background:rgba(0,0,0,.4); z-index:10; animation:fade .15s; }
.sheet { position:absolute; left:0; right:0; bottom:0; max-height:92%; z-index:11; background:var(--hp-card); border-radius:18px 18px 0 0; display:flex; flex-direction:column; animation:up .22s ease-out; padding-bottom:env(safe-area-inset-bottom); }
.wide .sheet { left:50%; right:auto; bottom:auto; top:50%; transform:translate(-50%,-50%); width:min(560px, 94%); max-height:86%; border-radius:18px; animation:fade .15s; }
.grab { width:40px; height:5px; border-radius:3px; background:var(--hp-line); margin:8px auto 0; } .wide .grab { display:none; }
.sheet .close { position:absolute; top:8px; right:8px; }
.sheetbody { overflow-y:auto; padding:12px 16px 20px; -webkit-overflow-scrolling:touch; }
.sheetbody h2 { padding-right:40px; }
@keyframes up { from { transform:translateY(100%); } } @keyframes fade { from { opacity:0; } }
.toast { position:absolute; left:50%; transform:translateX(-50%); top:calc(66px + env(safe-area-inset-top)); z-index:20; background:#323232; color:#fff; padding:10px 18px; border-radius:22px; font-size:.9rem; box-shadow:0 4px 12px rgba(0,0,0,.25); max-width:90%; text-align:center; animation:fade .2s; }
.wide .toast { top:auto; bottom:24px; } .toast.err { background:var(--hp-bad); }
@media (max-width: 380px) { .sethead, .setrow { grid-template-columns: 26px minmax(34px,1fr) 56px 42px 42px 34px 20px; gap:4px; } .summary { gap:10px; } .ringwrap { width:110px; height:110px; } }
`;

customElements.define("health-assistant-panel", HealthAssistantPanel);
