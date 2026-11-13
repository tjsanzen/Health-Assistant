/* Health Assistant — sidebar panel for Home Assistant.
 * Plain web component, no build step. Talks to the integration over websocket
 * (health_assistant/* commands). All data is stored metric; converted here for display.
 */
const DOMAIN = "health_assistant";
const LB = 2.2046226218;
const OZ_G = 28.349523125;
const MI_M = 1609.344;
const MEALS = ["breakfast", "lunch", "dinner", "snack"];
/** Meal to suggest from the time of day. */
const mealForNow = (h = new Date().getHours() + new Date().getMinutes() / 60) =>
  h >= 4 && h < 10.5 ? "breakfast" : h >= 10.5 && h < 14.5 ? "lunch" : h >= 16.5 && h < 21 ? "dinner" : "snack";
const TABS = [
  { id: "history", label: "History", icon: "mdi:history", title: "History" },
  { id: "workout", label: "Start Workout", icon: "mdi:plus", title: "Workout" },
  { id: "nutrition", label: "Nutrition", icon: "mdi:silverware-fork-knife", title: "Nutrition" },
  { id: "profile", label: "Profile", icon: "mdi:account-circle", title: "Profile" },
];
const SET_TYPES = {
  working: { label: "Working set", short: null, cls: "work" },
  warmup: { label: "Warm-up", short: "W", cls: "warm" },
  drop: { label: "Drop set", short: "D", cls: "drop" },
  failure: { label: "Failure", short: "F", cls: "fail" },
};
const EFFORT = [
  [10, "Maximum effort", "Couldn't have done another rep"],
  [9, "Very hard", "Could have done 1 more rep"],
  [8, "Hard", "Could have done 2 more reps"],
  [7, "Moderate", "Could have done 3 more reps"],
  [6, "Easy", "No real effort — 4+ reps left"],
];
const MAX_SAFE_DEFICIT = 600;
const HARD_SET_REST_S = 180; // rest after an effort-10 or failure set
const DEFICIT_WARNING = "Modern research suggests that a caloric deficit of more than 500-600 calories per day can be dangerous, and cause you to lose fat and muscle, even with high protein intake. We suggest a smaller deficit.";
const REST_OPTIONS = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];
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
const fmtDur = (s) => { if (s == null) return "–"; s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
const fmtRest = (s) => (!s ? "Off" : s % 60 ? fmtDur(s) : `${s / 60} min`);
const fmtDate = (iso, opts = { weekday: "short", month: "short", day: "numeric" }) => new Date(iso).toLocaleDateString(undefined, opts);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const num = (v) => (v === "" || v == null ? null : Number(v));
const toLocalInput = (d = new Date()) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const icon = (name, cls = "") => `<ha-icon class="${cls}" icon="${name}"></ha-icon>`;
const now = () => Date.now() / 1000;
const rid = () => Math.random().toString(16).slice(2, 14);

class Units {
  constructor(system) { this.imp = system === "imperial"; }
  get w() { return this.imp ? "lb" : "kg"; }
  get wCol() { return this.imp ? "lbs" : "kg"; }
  wOut(kg, digits = 1) { if (kg == null || isNaN(kg)) return null; const v = this.imp ? kg * LB : kg; const f = 10 ** digits; return Math.round(v * f) / f; }
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

/* Last time's set of the same kind: nth warm-up ↔ nth warm-up, nth work set ↔ nth work set. */
function prevFor(last, sets, i) {
  const list = last?.sets;
  if (!list || !list.length) return null;
  const warm = (x) => x.type === "warmup";
  const isWarm = warm(sets[i]);
  const n = sets.slice(0, i).filter((x) => warm(x) === isWarm).length;
  return list.filter((x) => warm(x) === isWarm)[n] || null;
}
const prCount = (w) => new Set((w.prs || []).map((p) => p.exercise_id)).size;
function blankSet(type = "working", prev) {
  return { id: rid(), type, weight: prev?.weight ?? null, reps: prev?.reps ?? null, rpe: null,
    duration_s: prev?.duration_s ?? null, distance_m: prev?.distance_m ?? null, completed: false };
}

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
      day: localDate(), food: null, stats: null, vitals: {}, sheets: [],
    };
    this._saveTimer = null;
  }

  set hass(h) { const first = !this._hass; this._hass = h; if (first) this._boot(); }
  get hass() { return this._hass; }
  set narrow(n) { const changed = this._narrow !== n; this._narrow = n; if (changed && this._booted) this._renderShell(); }
  set panel(p) { this._panel = p; }

  connectedCallback() {
    this._tick = setInterval(() => this._onTick(), 1000);
    this._vv = () => this._syncViewport();
    window.visualViewport?.addEventListener("resize", this._vv);
    window.visualViewport?.addEventListener("scroll", this._vv);
    window.addEventListener("resize", this._vv);
    this._syncViewport();
    this._vis = () => { if (document.visibilityState === "hidden") this._flushWorkout(); else if (this._booted) this._refreshActive(); };
    document.addEventListener("visibilitychange", this._vis);
  }
  disconnectedCallback() {
    clearInterval(this._tick);
    document.removeEventListener("visibilitychange", this._vis);
    window.visualViewport?.removeEventListener("resize", this._vv);
    window.visualViewport?.removeEventListener("scroll", this._vv);
    window.removeEventListener("resize", this._vv);
    this._flushWorkout();
  }

  /* On phones the panel is pinned to the *visible* part of the screen. When the
   * iOS keyboard opens, the visible area shrinks, so the panel and any open sheet
   * shrink with it instead of being covered, and the tab bar hides until it closes. */
  _syncViewport() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    const kb = Math.max(0, window.innerHeight - h - top);
    this.style.setProperty("--vvh", `${h}px`);
    this.style.setProperty("--vvtop", `${top}px`);
    this.shadowRoot.querySelector(".app")?.classList.toggle("kb", kb > 80);
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
    this._render();
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
    if (s.tab === "nutrition") {
      [s.food, s.stats] = await Promise.all([this.ws("food/day", { date: s.day }), this.ws("food/stats")]);
    }
    if (s.tab === "profile") {
      const [overview, weights] = await Promise.all([this.ws("overview", { date: localDate() }), this.ws("vitals/list", { vital_type: "weight", limit: 365 })]);
      s.overview = overview; s.vitals.weight = weights;
    }
  }

  async _reloadFood() {
    [this._s.food, this._s.stats] = await Promise.all([this.ws("food/day", { date: this._s.day }), this.ws("food/stats")]);
  }
  async _refreshOverview() { this._s.overview = await this.ws("overview", { date: localDate() }); }
  async _refreshActive() {
    try {
      const a = await this.ws("workout/active");
      if (!this._saveTimer && JSON.stringify(a) !== JSON.stringify(this._s.active)) {
        this._s.active = a;
        if (a) await this._loadLast(a.exercises.map((e) => e.exercise_id));
        if (this._s.tab === "workout") this._render(); else this._renderNav();
      }
    } catch (_) { /* offline: keep local state */ }
  }

  async _loadLast(ids) {
    const need = [...new Set(ids)].filter((id) => !(id in this._s.last));
    if (!need.length) return;
    Object.assign(this._s.last, await this.ws("exercises/last", { exercise_ids: need }));
  }

  _queueWorkoutSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._flushWorkout(), 600);
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
          <div class="title">${icon("mdi:food-apple", "brand")}<span>Health</span></div>
          <div class="spacer"></div>
          <div id="profilepick"></div>
          <nav class="topnav" id="topnav"></nav>
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
      root.addEventListener("focusin", (e) => {
        // Grab the field now: the browser clears e.target once the event has finished.
        const field = e.target;
        if (!this._narrow || !field?.matches?.("input,textarea")) return;
        setTimeout(() => {
          this._syncViewport();
          if (field.isConnected) field.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 350);
      });
      root.addEventListener("focusout", () => setTimeout(() => this._syncViewport(), 100));
      root.addEventListener("pointerdown", () => this._unlockAudio());
      root.addEventListener("touchstart", (e) => this._dragStart(e), { passive: true });
      root.addEventListener("touchmove", (e) => this._dragMove(e), { passive: false });
      root.addEventListener("touchend", () => this._dragEnd());
      this._wired = true;
    }
    this._syncViewport();
    this._render();
  }

  _profileSelect() {
    return this._s.profiles.length > 1
      ? `<select class="profilesel" data-change="profile" aria-label="Profile">${this._s.profiles.map((p) => `<option value="${p.id}" ${p.id === this._s.profileId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>` : "";
  }

  _renderNav() {
    const root = this.shadowRoot;
    const s = this._s;
    const btn = (t, bottom = false) => {
      const on = s.tab === t.id;
      const isW = t.id === "workout";
      // While a workout is running, the centre button shows the rest countdown when resting
      // (and nothing ticking otherwise) — the workout clock lives in the workout header.
      const rest = s.active?.rest;
      const label = isW && s.active ? (rest ? `Rest <span data-restnav>${fmtDur(Math.max(0, rest.ends_at - now()))}</span>` : "Workout") : t.label;
      return `<button class="navbtn ${on ? "on" : ""} ${isW ? "center" : ""}" data-action="tab" data-tab="${t.id}" ${isW && bottom ? 'data-center="1"' : ""}>
        <span class="navicon">${icon(isW && s.active ? "mdi:dumbbell" : t.icon)}</span><span class="navlabel">${label}</span></button>`;
    };
    const [hist, work, nut, prof] = TABS;
    root.getElementById("bottomnav").innerHTML =
      `<button class="navbtn" data-action="menu" aria-label="Home Assistant menu"><span class="navicon">${icon("mdi:menu")}</span><span class="navlabel">Menu</span></button>` +
      btn(hist) + btn(work, true) + btn(nut) + btn(prof);
    // Desktop header: right-aligned, with Start Workout furthest right.
    root.getElementById("topnav").innerHTML = btn(hist) + btn(nut) + btn(prof) + btn(work);
    root.getElementById("profilepick").innerHTML = this._profileSelect();
  }

  _render() {
    const root = this.shadowRoot;
    const content = root.getElementById("content");
    if (!content) return;
    this._renderNav();
    const scroll = content.scrollTop;
    const wide = !this._narrow && this._s.tab === "nutrition";
    content.innerHTML = `<div class="wrap ${wide ? "widewrap" : ""}">${this._view()}</div>`;
    content.scrollTop = scroll;
    this._renderSheet();
    this._renderRest();
  }

  _head(title, right = "") {
    // Large iOS-style title; only shown on phones (desktop has the header bar).
    return `<div class="pagehead"><h1>${esc(title)}</h1><div class="row">${right}</div></div>`;
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
    const head = this._head("History") + seg;
    if (s.historyMode === "records") return head + this._viewRecords();
    if (!s.workouts) return head + `<div class="empty">Loading…</div>`;
    if (!s.workouts.length) return head + `<div class="card empty">${icon("mdi:dumbbell", "bigicon")}<h2>No workouts yet</h2><p>Finished workouts show up here.</p><button class="btn primary" data-action="tab" data-tab="workout">Start a workout</button></div>`;
    let month = "";
    const items = s.workouts.map((w) => {
      const m = fmtDate(w.started_at, { month: "long", year: "numeric" });
      const mh = m !== month ? `<h3 class="month">${m}</h3>` : "";
      month = m;
      const sm = w.summary || {};
      const lines = w.exercises.slice(0, 4).map((e) => `<div class="exline"><span>${e.sets.length} × ${esc(this._exName(e.exercise_id))}</span><span class="muted">${this._bestSetText(e)}</span></div>`).join("");
      const more = w.exercises.length > 4 ? `<div class="muted small">+${w.exercises.length - 4} more</div>` : "";
      const pc = prCount(w);
      return `${mh}<button class="card workout" data-action="openWorkout" data-id="${w.id}">
        <div class="row between"><b>${esc(w.name)}</b><span class="row">${w.apple_health_saved ? `<span class="badge health" title="Saved to Apple Health">${icon("mdi:heart")} Health</span>` : ""}${pc ? `<span class="badge gold">${icon("mdi:trophy")} ${pc} PR${pc > 1 ? "s" : ""}</span>` : ""}</span></div>
        <div class="muted small">${fmtDate(w.started_at)} · ${fmtTime(w.started_at)}</div>
        <div class="stats">
          <span>${icon("mdi:timer-outline")} ${fmtDur(sm.duration_s)}</span>
          <span>${icon("mdi:weight")} ${r0(this._units.wOut(sm.volume_kg, 0))} ${this._units.w}</span>
          <span>${icon("mdi:format-list-numbered")} ${sm.sets} sets</span>
          ${sm.kcal_active != null ? `<span>${icon("mdi:fire")} ${r0(sm.kcal_active)} kcal</span>` : ""}
        </div>${lines}${more}</button>`;
    }).join("");
    const loadMore = s.workouts.length < s.workoutsTotal ? `<button class="btn ghost full" data-action="moreWorkouts">Load more</button>` : "";
    return head + items + loadMore;
  }

  _bestSetText(ex) {
    const kind = this._exMap[ex.exercise_id]?.kind;
    const counted = ex.sets.filter((x) => x.type !== "warmup");
    if (!counted.length) return "";
    if (kind === "duration") return fmtDur(Math.max(...counted.map((x) => x.duration_s || 0)));
    if (kind === "distance") return `${r1(this._units.dOut(Math.max(...counted.map((x) => x.distance_m || 0))))} ${this._units.d}`;
    const score = (x) => (x.weight || 0) * (1 + (x.reps || 0) / 30);
    const best = counted.reduce((a, b) => (score(b) > score(a) ? b : a));
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
        return `<tr><td>${this._setBadge(x.type, n)}</td><td>${this._setText(e.exercise_id, x)}</td><td class="muted right">${x.rpe ? `Effort ${x.rpe}` : ""}</td></tr>`;
      }).join("");
      return `<div class="detailex"><b>${esc(this._exName(e.exercise_id))}</b><table class="settable">${rows}</table></div>`;
    }).join("");
    return `<h2>${esc(w.name)}</h2>
      <div class="muted">${fmtDate(w.started_at, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · ${fmtTime(w.started_at)}</div>
      <div class="stats big"><span>${icon("mdi:timer-outline")} ${fmtDur(sm.duration_s)}</span><span>${icon("mdi:weight")} ${r0(u.wOut(sm.volume_kg, 0))} ${u.w}</span><span>${icon("mdi:format-list-numbered")} ${sm.sets} sets</span></div>
      ${sm.kcal_active != null ? `<div class="kcalbox">
        <div><div class="big">${r0(sm.kcal_active)}</div><div class="muted xsmall">active kcal</div></div>
        <div><div class="big">${r0(sm.kcal_total)}</div><div class="muted xsmall">total kcal</div></div>
        <div class="muted xsmall kcalsplit">${r0(sm.active_min)} min lifting · ${r0(sm.rest_min)} min rest & moving${sm.idle_min >= 1 ? ` · ${r0(sm.idle_min)} min idle` : ""}${sm.timed === false ? "<br>Estimated from your planned rest times (older workout)" : ""}</div>
      </div>` : ""}
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
    if (!x) return "–";
    if (kind === "duration") return fmtDur(x.duration_s);
    if (kind === "distance") return `${r1(u.dOut(x.distance_m))} ${u.d}`;
    if (kind === "bodyweight_reps") return `${x.weight ? `+${r1(u.wOut(x.weight))} × ` : ""}${x.reps ?? "–"}`;
    if (x.weight == null && x.reps == null) return "–";
    return `${r1(u.wOut(x.weight))} × ${x.reps ?? "–"}`;
  }

  _setBadge(type, n) {
    const t = SET_TYPES[type] || SET_TYPES.working;
    return `<span class="setbadge ${t.cls}">${t.short || n}</span>`;
  }

  async _sheetExerciseHtml(id) {
    const ex = this._exMap[id] || { name: id };
    const hist = await this.ws("exercises/history", { exercise_id: id });
    const pts = hist.filter((h) => h.best_e1rm).map((h) => ({ x: new Date(h.date).getTime(), y: this._units.wOut(h.best_e1rm) })).reverse();
    const rows = hist.slice(0, 15).map((h) => `<div class="histrow"><div class="muted small">${fmtDate(h.date)}</div><div>${h.sets.filter((x) => x.type !== "warmup").map((x) => this._setText(id, x)).join(", ")}</div></div>`).join("");
    const muscles = [ex.muscle, ...(ex.secondary || [])].filter(Boolean).join(", ");
    return `<h2>${esc(ex.name)}</h2><div class="muted">${esc(muscles)}${ex.equipment ? ` · ${esc(ex.equipment)}` : ""}</div>
      ${ex.demo_url ? `<img class="demo" src="${esc(ex.demo_url)}" alt="${esc(ex.name)} demonstration" loading="lazy">` : ""}
      ${ex.instructions?.length ? `<h3>How to</h3><ol class="steps">${ex.instructions.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>` : ""}
      ${ex.tips?.length ? `<h3>Tips</h3><ul class="steps">${ex.tips.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
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
    return this._head("Workout") + `<div class="card hero">
        ${icon("mdi:dumbbell", "bigicon")}
        <h2>Ready to train?</h2>
        <button class="btn primary big full" data-action="startWorkout">${icon("mdi:plus")} Start empty workout</button>
      </div>
      <div class="row between section"><h3>Templates</h3><button class="btn ghost" data-action="newTemplate">${icon("mdi:plus")} New template</button></div>
      ${tpls || `<div class="card empty small"><p>Save a workout as a template, or create one to start faster next time.</p></div>`}`;
  }

  _supersetLabels() {
    const map = {};
    let i = 0;
    for (const e of this._s.active.exercises) if (e.superset && !(e.superset in map)) map[e.superset] = String.fromCharCode(65 + i++);
    return map;
  }

  _viewActive() {
    const w = this._s.active;
    const u = this._units;
    const ssl = this._supersetLabels();
    const exs = w.exercises.map((e, ei) => {
      const ex = this._exMap[e.exercise_id] || { name: e.exercise_id, kind: "weight_reps" };
      const last = this._s.last[e.exercise_id];
      const kind = ex.kind;
      const cols = kind === "duration" ? ["Time"] : kind === "distance" ? [u.d, "Min"] : kind === "bodyweight_reps" ? [`+${u.wCol}`, "Reps"] : [u.wCol, "Reps"];
      let n = 0;
      const rows = e.sets.map((x, si) => {
        if (x.type === "working") n++;
        const prev = prevFor(last, e.sets, si);
        const ph = (v) => (v == null ? "" : v);
        let inputs;
        if (kind === "duration") inputs = `<input class="cell wide" inputmode="numeric" data-set="duration_s" data-e="${ei}" data-s="${si}" value="${ph(x.duration_s)}" placeholder="${ph(prev?.duration_s)}" aria-label="Seconds">`;
        else if (kind === "distance") inputs = `<input class="cell" inputmode="decimal" data-set="distance" data-e="${ei}" data-s="${si}" value="${x.distance_m != null ? u.dOut(x.distance_m) : ""}" placeholder="${prev?.distance_m != null ? u.dOut(prev.distance_m) : ""}" aria-label="Distance">
            <input class="cell" inputmode="decimal" data-set="minutes" data-e="${ei}" data-s="${si}" value="${x.duration_s != null ? r1(x.duration_s / 60) : ""}" aria-label="Minutes">`;
        else inputs = `<input class="cell" inputmode="decimal" data-set="weight" data-e="${ei}" data-s="${si}" value="${x.weight != null ? u.wOut(x.weight) : ""}" placeholder="${prev?.weight != null ? u.wOut(prev.weight) : ""}" aria-label="${u.wCol}">
            <input class="cell" inputmode="numeric" data-set="reps" data-e="${ei}" data-s="${si}" value="${ph(x.reps)}" placeholder="${ph(prev?.reps)}" aria-label="Reps">`;
        return `<div class="setrow ${x.completed ? "done" : ""} k-${kind}">
          <button class="setbtn" data-action="setMenu" data-e="${ei}" data-s="${si}" aria-label="Set type">${this._setBadge(x.type, n)}</button>
          <button class="prev" data-action="usePrev" data-e="${ei}" data-s="${si}">${esc(this._prevText(kind, prev))}</button>
          ${inputs}
          <button class="check ${x.completed ? "on" : ""}" data-action="toggleSet" data-e="${ei}" data-s="${si}" aria-label="Complete set">${icon("mdi:check")}${x.completed && x.rpe ? `<span class="rpe">${x.rpe}</span>` : ""}</button>
        </div>`;
      }).join("");
      const ss = e.superset ? `<span class="sstag">Superset ${ssl[e.superset]}</span>` : "";
      return `<div class="card exercise ${e.superset ? `ss ss${(ssl[e.superset].charCodeAt(0) - 65) % 4}` : ""}">
        <div class="exhead">
          <button class="extitle" data-action="openExercise" data-id="${e.exercise_id}">${esc(ex.name)}</button>
          <button class="iconbtn" data-action="exMenu" data-e="${ei}" aria-label="Exercise options">${icon("mdi:dots-horizontal")}</button>
        </div>
        <div class="exmeta">${ss}<span>${icon("mdi:timer-outline")} ${fmtRest(e.rest_s ?? 120)}</span></div>
        <div class="sethead k-${kind}"><span>Set</span><span>Previous</span>${cols.map((h) => `<span>${h}</span>`).join("")}<span>${icon("mdi:check")}</span></div>
        ${rows}
        <button class="btn soft full" data-action="addSet" data-e="${ei}">${icon("mdi:plus")} Add set</button>
      </div>`;
    }).join("");
    return `<div class="activehead">
        <input class="wname" data-wfield="name" value="${esc(w.name)}" aria-label="Workout name">
        <div class="row between"><span class="timer">${icon("mdi:timer-outline")} <span data-elapsed>${fmtDur(this._elapsed())}</span></span>
          <button class="btn primary" data-action="finishWorkout">Finish</button></div>
      </div>
      ${exs}
      <button class="btn primary full big" data-action="addExercise">${icon("mdi:plus")} Add exercise</button>
      <textarea class="wnotes" data-wfield="notes" placeholder="Workout notes">${esc(w.notes || "")}</textarea>
      <button class="btn danger ghost full" data-action="discardWorkout">Discard workout</button>`;
  }

  _elapsed() { const a = this._s.active; return a ? now() - new Date(a.started_at).getTime() / 1000 : 0; }

  _onTick() {
    if (this._s.active) this.shadowRoot.querySelectorAll("[data-elapsed]").forEach((el) => (el.textContent = fmtDur(this._elapsed())));
    const rest = this._s.active?.rest;
    if (rest) {
      const left = rest.ends_at - now();
      if (left <= 0) {
        // Only chime if we noticed on time (not when coming back to a tab that slept through it).
        const fresh = left > -10;
        const next = rest.next;
        this._setRest(null, true);
        if (fresh) this._restDone(next);
      } else {
        this._renderRest();
        this.shadowRoot.querySelectorAll("[data-restnav]").forEach((el) => (el.textContent = fmtDur(left)));
      }
    }
  }
  _restDone(next) {
    // In the iPhone app with a rest sound on, the rest-over notification already plays it.
    const prof = this._s.overview?.profile || {};
    const phoneSounds = /Home Assistant\//.test(navigator.userAgent) && prof.live_activity_notify && (prof.rest_sound || "chime") !== "off";
    if (!phoneSounds) this._playChime();
    try { navigator.vibrate?.([200, 100, 200]); } catch (_) { /* iOS has no vibrate */ }
    this._toast(next ? `Rest over — ${next}` : "Rest over — next set!");
  }

  /* --- chime: iOS only lets a page play sound after a tap, so the audio is unlocked on the
     first tap in the panel and the chime is decoded ahead of time. */
  _unlockAudio() {
    if (this._audioCtx || !this._s.overview?.chime_url) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this._audioCtx = new Ctx();
      this._audioCtx.resume();
      // A silent blip inside the tap is what actually unlocks iOS audio.
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._audioCtx.createBuffer(1, 1, 22050);
      src.connect(this._audioCtx.destination); src.start(0);
      fetch(this._s.overview.chime_url).then((r) => r.arrayBuffer())
        .then((b) => new Promise((ok, bad) => this._audioCtx.decodeAudioData(b, ok, bad)))
        .then((buf) => (this._chime = buf)).catch((e) => console.warn("Chime failed to load", e));
    } catch (e) { console.warn(e); }
  }
  _playChime() {
    const ctx = this._audioCtx;
    if (!ctx || !this._chime) return;
    try {
      if (ctx.state !== "running") ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = this._chime; src.connect(ctx.destination); src.start(0);
    } catch (e) { console.warn(e); }
  }

  _renderRest() {
    const el = this.shadowRoot.getElementById("rest");
    if (!el) return;
    const r = this._s.active?.rest;
    if (!r) { el.innerHTML = ""; return; }
    const left = Math.max(0, r.ends_at - now());
    const bar = el.querySelector(".restbar");
    if (bar) { // update only the digits so nothing moves
      bar.querySelector("[data-restleft]").textContent = fmtDur(left);
      return;
    }
    // Static bar: countdown (and next set) on the left, −15 / +15 / Skip on the right.
    el.innerHTML = `<div class="restbar">
      <div class="restleft">
        <div class="resttime">${icon("mdi:timer-sand")}<b data-restleft>${fmtDur(left)}</b></div>
        ${r.next ? `<div class="restnext">Next: ${esc(r.next)}</div>` : ""}
      </div>
      <div class="restbtns"><button class="btn sm" data-action="restAdj" data-d="-15">−15</button><button class="btn sm" data-action="restAdj" data-d="15">+15</button><button class="btn sm primary" data-action="restSkip">Skip</button></div></div>`;
  }

  /** Start/adjust/clear the rest timer locally and tell HA (which drives the iPhone Live Activity). */
  async _setRest(rest, quiet = false) {
    const a = this._s.active;
    if (!a) return;
    a.rest = rest;
    this.shadowRoot.getElementById("rest").innerHTML = "";
    this._renderRest();
    this._renderNav();
    try {
      await this.ws("rest/set", rest ? { ends_at: rest.ends_at, total: rest.total, exercise_id: rest.exercise_id, next: rest.next || null } : { ends_at: null });
    } catch (e) { if (!quiet) this._toast(e.message, true); }
  }

  /* ========================================================== NUTRITION */
  _viewNutrition() {
    const s = this._s;
    const f = s.food;
    if (!f) return this._head("Nutrition") + `<div class="empty">Loading…</div>`;
    const today = localDate();
    const dayLabel = s.day === today ? "Today" : s.day === addDays(today, -1) ? "Yesterday" : fmtDate(s.day + "T12:00:00");
    const t = f.totals, mt = f.macro_targets || {};
    const target = f.target || 0;
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
    const left = `<div class="datenav"><button class="iconbtn" data-action="day" data-d="-1" aria-label="Previous day">${icon("mdi:chevron-left")}</button>
        <button class="linklike" data-action="dayToday"><b>${dayLabel}</b></button>
        <button class="iconbtn" data-action="day" data-d="1" ${s.day >= today ? "disabled" : ""} aria-label="Next day">${icon("mdi:chevron-right")}</button></div>
      <div class="card summary">
        <div class="ringwrap">${ringChart(t.kcal, target)}<div class="ringtext"><div class="big">${r0(Math.abs(f.remaining ?? 0))}</div><div class="muted small">${(f.remaining ?? 0) >= 0 ? "kcal left" : "kcal over"}</div></div></div>
        <div class="sumright">
          <div class="row between small"><span>Eaten</span><b>${r0(t.kcal)}</b></div>
          <div class="row between small"><span>Target</span><b>${r0(target)}</b></div>
          ${macro("protein", "Protein", "p")}${macro("carbs", "Carbs", "c")}${macro("fat", "Fat", "f")}
        </div>
      </div>
      ${s.overview && !s.overview.food_db ? `<div class="card warn small">Food database not found — search shows only your custom foods. See the README to build it.</div>` : ""}
      ${meals}`;
    // OpenNutrition's terms require attribution wherever its data is shown.
    return this._head("Nutrition") + `<div class="cols"><div class="colmain">${left}</div><aside class="colside">${this._statsHtml()}</aside></div>
      <p class="attribution">Data Source: <a href="https://www.opennutrition.app" target="_blank" rel="noopener noreferrer">OpenNutrition</a></p>`;
  }

  _statsHtml() {
    const st = this._s.stats;
    if (!st) return "";
    const W = [["d7", "7 days"], ["d30", "30 days"], ["all", `All (${st.all.days_logged}d)`]];
    const row = (label, key, unit) => `<tr><th>${label}</th>${W.map(([k]) => { const v = st[k].avg[key]; return `<td>${v == null ? "–" : r0(v) + unit}</td>`; }).join("")}</tr>`;
    const max = Math.max(st.target || 0, ...st.series.map((d) => d.kcal), 1) * 1.08;
    const today = localDate();
    const bars = st.series.map((d) => {
      const h = (d.kcal / max) * 100;
      const over = st.target && d.kcal > st.target * 1.1;
      const dt = new Date(d.date + "T12:00:00");
      return `<div class="bcol" title="${fmtDate(d.date + "T12:00:00")}: ${r0(d.kcal)} kcal"><div class="bbar ${over ? "over" : ""} ${d.date === today ? "today" : ""}" style="height:${h}%"></div><span>${"SMTWTFS"[dt.getDay()]}</span></div>`;
    }).join("");
    const tl = st.target ? `<div class="tline" style="bottom:${(st.target / max) * 100}%"><span>${r0(st.target)}</span></div>` : "";
    const d30 = st.d30;
    return `<div class="card stats-card">
        <h3>Averages</h3>
        <table class="avg"><thead><tr><th></th>${W.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead>
        <tbody>${row("Calories", "kcal", "")}${row("Protein", "protein", " g")}${row("Carbs", "carbs", " g")}${row("Fat", "fat", " g")}</tbody></table>
        <div class="muted xsmall">Averages use days you logged food, not counting today.</div>
      </div>
      <div class="card"><h3>Last 14 days</h3><div class="bars"><div class="plot">${tl}${bars}</div></div></div>
      <div class="minitiles">
        <div class="card mini"><div class="muted small">Logging streak</div><div class="big">${st.streak}<small> day${st.streak === 1 ? "" : "s"}</small></div></div>
        <div class="card mini"><div class="muted small">On target · 30 days</div><div class="big">${d30.on_target_days ?? "–"}<small> / ${d30.days_logged}</small></div><div class="muted xsmall">within ±10%</div></div>
      </div>`;
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
      body = `<div class="searchbox">${icon("mdi:magnify")}<input id="foodq" type="search" placeholder="Search OpenNutrition Database" value="${esc(sh.query || "")}" data-input="foodSearch" autocomplete="off" enterkeyhint="search"></div>
        <div id="foodresults">${this._foodResults(sh)}</div>`;
    } else if (sh.mode === "quick") {
      body = `<div class="form">
        <label>Name<input data-q="name" value="Quick add"></label>
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
      <div class="muted small">${esc(servingLabel(f))}</div></div><span class="kcal">${r0(portion(f, 1, "serving").kcal)}</span></button>`;
    if (!sh.query) {
      const recent = sh.recent || [], custom = sh.custom || [];
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
    if (!o) return this._head("Profile") + `<div class="empty">Loading…</div>`;
    const u = this._units, p = o.profile, e = o.energy || {};
    const weights = (this._s.vitals.weight || []).slice().reverse();
    const cur = o.latest.weight?.value;
    const start = weights[0]?.value ?? cur;
    const target = p.target_weight_kg;
    let pct = 0;
    if (start != null && target != null && start !== target) pct = Math.max(0, Math.min(100, ((start - cur) / (start - target)) * 100));
    const pts = weights.map((v) => ({ x: new Date(v.recorded_at).getTime(), y: u.wOut(v.value) }));
    const goalWord = { lose: "Lose weight", gain: "Gain weight", maintain: "Maintain" }[e.goal] || "";
    const st = o.steps || {};
    const stepsTile = `<button class="tile" data-action="stepsInfo">${icon("mdi:walk")}<div class="muted small">Steps</div>
        <div class="tileval">${st.today != null ? r0(st.today) : "–"}</div>
        <div class="muted xsmall">${st.sensor ? (st.avg != null ? `${r0(st.avg)} avg · ${st.days}d` : "Today") : "Not connected"}</div></button>`;
    const tiles = stepsTile + Object.entries(VITALS).map(([k, v]) => {
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
    const manual = e.target_manual || (e.macros_manual || []).length;
    return this._head("Profile", this._narrow ? this._profileSelect() : "") + `<div class="card">
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
      <div class="row between section"><h3>Daily targets</h3><button class="btn ghost" data-action="editTargets">${icon("mdi:pencil")} Edit</button></div>
      <div class="card energy">
        <div class="egrid">
          <div><div class="muted small">Calories${e.target_manual ? ` <span class="badge blue">Manual</span>` : ""}</div><div class="big accent">${r0(e.target)}</div></div>
          <div><div class="muted small">Maintenance</div><div class="big">${r0(e.maintenance)}</div></div>
          <div><div class="muted small">BMR</div><div class="big">${r0(e.bmr)}</div></div>
        </div>
        <div class="egrid">
          <div><div class="muted small">Protein</div><b>${r0(e.protein_g)} g</b></div>
          <div><div class="muted small">Carbs</div><b>${r0(e.carbs_g)} g</b></div>
          <div><div class="muted small">Fat</div><b>${r0(e.fat_g)} g</b></div>
        </div>
        <div class="muted small">${esc(e.formula || "")} · ${esc(e.activity_label || "")} (×${e.activity_multiplier ?? "–"}) · ${r0(e.steps_used ?? p.daily_steps)} steps/day${e.steps_source === "tracked" ? " (iPhone, 14-day avg)" : ""} · ${e.lifting?.active ? `~${r0(e.lifting.kcal_per_day)} kcal/day from lifting (${r1(e.lifting.sessions_per_week)} workouts/wk, 4-week avg)` : `${p.lifting_days} lifting day${p.lifting_days === 1 ? "" : "s"}/wk${e.lifting?.days_logged ? ` · switches to your logged workouts in ${Math.max(0, 14 - e.lifting.days_logged)} days` : ""}`}</div>
        <div class="muted small">Protein: ${esc(e.protein_rule || "")} of body weight</div>
        ${manual ? `<div class="muted small">Calculated target: ${r0(e.target_auto)} kcal</div>` : e.daily_adjustment ? `<div class="muted small">${e.daily_adjustment < 0 ? "Deficit" : "Surplus"} of ${r0(Math.abs(e.daily_adjustment))} kcal/day for ${r1(u.wOut(p.goal_rate_kg_week, 2))} ${u.w}/week${e.target_floored ? " (raised to a safe minimum)" : ""}</div>` : ""}
      </div>
      <h3 class="section">Settings</h3>
      <div class="card list">
        <button class="listrow" data-action="workoutSettings">${icon("mdi:timer-cog-outline")}<span>iPhone, rest timer & Apple Health</span><span class="muted">${fmtRest(p.rest_default_s ?? 120)}${p.live_activity_notify ? " · iPhone" : ""}</span>${icon("mdi:chevron-right", "muted")}</button>
        <button class="listrow" data-action="editProfile">${icon("mdi:account-edit-outline")}<span>Body & goal</span><span></span>${icon("mdi:chevron-right", "muted")}</button>
        <button class="listrow" data-action="importOpen">${icon("mdi:database-import-outline")}<span>Import workout history</span><span class="muted">Strong</span>${icon("mdi:chevron-right", "muted")}</button>
      </div>`;
  }

  _sheetVital(sh) {
    const u = this._units, v = VITALS[sh.type];
    let fields;
    if (sh.type === "weight") fields = `<label>Weight (${u.w})<input data-v="value" inputmode="decimal"></label>`;
    else if (sh.type === "height") fields = u.imp
      ? `<div class="grid2"><label>Feet<input data-v="ft" inputmode="numeric"></label><label>Inches<input data-v="in" inputmode="decimal"></label></div>`
      : `<label>Height (cm)<input data-v="value" inputmode="decimal"></label>`;
    else if (sh.type === "blood_pressure") fields = `<div class="grid2"><label>Systolic<input data-v="systolic" inputmode="numeric"></label><label>Diastolic<input data-v="diastolic" inputmode="numeric"></label></div>`;
    else fields = `<label>${v.label} (${v.unit})<input data-v="value" inputmode="decimal"></label>`;
    const fmt = (x) => sh.type === "weight" ? `${r1(u.wOut(x.value))} ${u.w}` : sh.type === "height" ? u.h(x.value)
      : sh.type === "blood_pressure" ? `${r0(x.systolic)}/${r0(x.diastolic)} mmHg` : `${r1(x.value)} ${v.unit}`;
    const hist = (sh.list || []).map((x) => `<div class="histrow row between"><div><div>${fmt(x)}</div><div class="muted small">${fmtDate(x.recorded_at)} · ${fmtTime(x.recorded_at)}${x.note ? ` · ${esc(x.note)}` : ""}</div></div>
      <button class="iconbtn sm" data-action="deleteVital" data-id="${x.id}" aria-label="Delete">${icon("mdi:delete-outline")}</button></div>`).join("");
    return `<h2>${icon(v.icon)} ${v.label}</h2>
      <div class="form">${fields}<label>When<input type="datetime-local" data-v="when" value="${toLocalInput()}"></label>
      <label>Note (optional)<input data-v="note"></label>
      <button class="btn primary full" data-action="saveVital">Save</button></div>
      ${sh.list ? (hist ? `<h3>History</h3>${hist}` : "") : `<p class="muted center small">Loading history…</p>`}`;
  }

  _sheetTargets() {
    const o = this._s.overview, p = o.profile, e = o.energy;
    const auto = e.macros_auto || {};
    const val = (k) => (p[k] ? p[k] : "");
    return `<h2>Daily targets</h2>
      <p class="muted small">Leave a field blank to use the calculated value (shown in grey). If you only set calories, protein stays calculated, fat is 25% and carbs fill the rest.</p>
      <div class="form">
        <label>Calories (kcal)<input data-t="calorie_target_override" inputmode="numeric" value="${val("calorie_target_override")}" placeholder="${r0(e.target_auto)}"></label>
        <div class="grid3">
          <label>Protein (g)<input data-t="protein_override_g" inputmode="numeric" value="${val("protein_override_g")}" placeholder="${r0(auto.protein_g)}"></label>
          <label>Carbs (g)<input data-t="carbs_override_g" inputmode="numeric" value="${val("carbs_override_g")}" placeholder="${r0(auto.carbs_g)}"></label>
          <label>Fat (g)<input data-t="fat_override_g" inputmode="numeric" value="${val("fat_override_g")}" placeholder="${r0(auto.fat_g)}"></label>
        </div>
        <div class="muted small" id="macrokcal"></div>
        <button class="btn primary full" data-action="saveTargets">Save</button>
        <button class="btn ghost full" data-action="resetTargets">Use calculated targets</button>
      </div>`;
  }

  _sheetWorkoutSettings(sh) {
    const p = this._s.overview.profile;
    const cur = p.rest_default_s ?? 120;
    const targets = sh.targets;
    return `<h2>iPhone, rest timer & Apple Health</h2>
      <div class="form">
        <label>Default rest timer
          <select data-ws="rest_default_s">${REST_OPTIONS.map((v) => `<option value="${v}" ${v === cur ? "selected" : ""}>${fmtRest(v)}</option>`).join("")}</select></label>
        <p class="muted small">New exercises use this. Each exercise remembers its own rest time once you change it from the ••• menu.</p>
        <label>Show rest timer on iPhone (Dynamic Island & Lock Screen)
          <select data-ws="live_activity_notify"><option value="">Off</option>${(targets || []).map((t) => `<option value="${esc(t)}" ${t === p.live_activity_notify ? "selected" : ""}>${esc(t.replace(/^mobile_app_/, "").replace(/_/g, " "))}</option>`).join("")}</select></label>
        ${targets && !targets.length ? `<p class="muted small">No Companion app devices found. Install the Home Assistant app on your phone and sign in first.</p>` : ""}
        <button class="btn soft full" data-action="testLive">${icon("mdi:cellphone-arrow-down")} Send a test (60-second countdown)</button>
        <p class="muted small">Uses Live Activities from the Home Assistant Companion app (iOS 17.2+, Home Assistant 2026.7+). While you rest, your Lock Screen and Dynamic Island count down and show your next set. If the test doesn't appear: allow Live Activities for Home Assistant in iPhone Settings → Home Assistant, accept the one-time Lock Screen notice, and make sure the phone can reach Home Assistant. iOS also limits how many activities can be started in a row, so repeated tests may stop appearing for a while.</p>
        <label>Sound when rest is over
          <select data-ws="rest_sound">${[["chime", "Chime (import once, see below)"], ["default", "iPhone default sound"], ["off", "No sound — vibrate only"]].map(([v, l]) => `<option value="${v}" ${v === (p.rest_sound || "chime") ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <button class="btn soft full" data-action="testSound">${icon("mdi:headphones")} Play the rest-over sound on my phone</button>
        <p class="muted small">Sent as a notification at the end of each rest, so it plays even when this app is closed and comes through your headphones when they're connected. Your phone's ring/silent switch still applies. To use the chime, ${this._s.overview.chime_wav_url ? `<a href="${esc(this._s.overview.chime_wav_url)}" download="health_assistant_chime.wav" target="_blank">download the chime file</a>` : "download the chime file"} and save it to Files or iCloud Drive, then in the Home Assistant app go to Settings → Companion app → Notifications → Sounds → Import custom sound, pick it, and restart your iPhone. Until then, iOS plays its default sound.</p>
        <h3>Steps</h3>
        <label>Step counter
          <select data-ws="steps_sensor"><option value="">Off — use the number from setup</option>${(sh.sensors || []).map((x) => `<option value="${esc(x.entity_id)}" ${x.entity_id === p.steps_sensor ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
        <p class="muted small">Uses the Companion app's step sensor. Once 3 days are recorded, your 14-day average replaces the steps you entered at setup when working out maintenance calories. It counts steps your iPhone detects (not your Apple Watch). If it's missing, turn on the Steps sensor in the Companion app: Settings → Companion app → Sensors.</p>
        <h3>Apple Health</h3>
        <label class="inline"><input type="checkbox" data-ws="apple_health_export" ${p.apple_health_export !== false ? "checked" : ""} style="width:auto"> After a workout, offer to save it to Apple Health</label>
        <label>Shortcut name<input data-ws="apple_health_shortcut" value="${esc(p.apple_health_shortcut || "Health Assistant Log Workout")}"></label>
        <p class="muted small">You'll get a notification on the phone above when you finish a workout; tapping it runs this Shortcut, which logs a strength workout (time, duration, calories) in Apple Health. See the README for how to build the Shortcut.</p>
        <button class="btn primary full" data-action="saveWorkoutSettings">Save</button>
      </div>`;
  }

  _sheetImport(sh) {
    const r = sh.result;
    const intro = `<h2>${icon("mdi:database-import-outline")} Import workout history</h2>
      <p class="muted small">A one-time import from the <b>Strong</b> app. In Strong, use <b>Export Data</b> in Settings, save the CSV, then pick it here. You'll see how every exercise was matched before anything is saved, and importing the same file again only adds workouts that aren't already here.</p>`;
    if (sh.busy) return intro + `<p class="center muted">${esc(sh.busy)}</p>`;
    if (!r) return intro + `<label class="filepick">${icon("mdi:file-delimited-outline")} Choose CSV file<input type="file" accept=".csv,text/csv" data-change="importFile" hidden></label>
      ${sh.error ? `<div class="card warn small">${esc(sh.error)}</div>` : ""}`;
    const how = { table: "", name: "", fuzzy: " (closest name)", none: " (new custom exercise)" };
    const rows = r.matches.map((m) => `<div class="maprow"><span>${esc(m.strong)}</span>${icon("mdi:arrow-right", "muted")}<span class="${m.exercise_id ? "" : "accent"}">${esc(m.name || m.strong)}${how[m.how] || ""}</span><span class="muted xsmall">${m.sets}</span></div>`).join("");
    const done = !r.dry_run;
    return intro + `<div class="card ${done ? "" : "importsum"}">
        ${done ? `<b>${icon("mdi:check-circle", "accent")} Imported ${r.new_workouts} workouts (${r.sets.toLocaleString()} sets)</b>`
          : `<b>${r.new_workouts} new workout${r.new_workouts === 1 ? "" : "s"} · ${r.sets.toLocaleString()} sets</b>`}
        ${r.first ? `<div class="muted small">${fmtDate(r.first, { month: "short", day: "numeric", year: "numeric" })} – ${fmtDate(r.last, { month: "short", day: "numeric", year: "numeric" })}</div>` : ""}
        ${r.already_imported ? `<div class="muted small">${r.already_imported} already imported — skipped</div>` : ""}
        ${r.skipped_empty_sets ? `<div class="muted small">${r.skipped_empty_sets} empty sets ignored</div>` : ""}
      </div>
      ${done ? `<p class="muted small">History, records and PRs now include your Strong workouts, and calories were estimated from each workout's length. Your lifting calories update maintenance automatically.</p>
          <button class="btn primary full" data-action="closeSheet">Done</button>`
        : `${r.new_workouts ? `<button class="btn primary full big" data-action="importRun">Import ${r.new_workouts} workouts</button>` : `<p class="muted center">Nothing new to import.</p>`}
          <h3>How exercises were matched</h3><div class="muted xsmall">Strong name → Health Assistant · sets</div>
          <div class="maplist">${rows}</div>`}
      ${sh.imported ? `<button class="btn danger ghost full" data-action="importUndo">Remove all ${sh.imported} imported Strong workouts</button>` : ""}`;
  }

  _sheetProfile() {
    const p = this._s.overview.profile, u = this._units;
    const e = this._s.overview.energy || {};
    const lift = e.lifting || {};
    const stepsTracked = e.steps_source === "tracked";
    const hcm = this._s.overview.latest.height?.value ?? p.height_cm;
    const tin = hcm / 2.54;
    return `<h2>Body & goal</h2><div class="form">
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
        <label>Avg steps / day${stepsTracked ? `<input value="${r0(e.steps_used)} (tracked)" disabled>` : `<input data-p="steps" inputmode="numeric" value="${p.daily_steps}">`}</label>
        <label>Lifting days / week${lift.active ? `<input value="~${r0(lift.kcal_per_day)} kcal/day (tracked)" disabled>` : `<input data-p="lift" inputmode="numeric" value="${p.lifting_days}">`}</label>
      </div>
      ${stepsTracked || lift.active ? `<p class="muted small">Tracked values come from your iPhone's step counter and your logged workouts, and update automatically.</p>` : ""}
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

  _pickerList(sh) {
    const words = (sh.query || "").toLowerCase().split(/\s+/).filter(Boolean);
    const hay = (e) => `${e.name} ${e.muscle} ${e.equipment}`.toLowerCase();
    const list = this._s.exercises.filter((e) => (!sh.muscle || e.muscle === sh.muscle) && words.every((w) => hay(e).includes(w)));
    return list.map((e) => `<button class="foodrow" data-action="pickExercise" data-id="${e.id}"><div><div>${esc(e.name)}</div><div class="muted small">${esc(e.muscle)} · ${esc(e.equipment)}</div></div>${icon("mdi:plus")}</button>`).join("")
      || `<p class="muted center">No matches.</p>`;
  }

  _sheetPicker(sh) {
    const muscles = [...new Set(this._s.exercises.map((e) => e.muscle))];
    return `<h2>${esc(sh.title || "Add exercise")}</h2>
      <div class="searchbox">${icon("mdi:magnify")}<input id="exq" type="search" placeholder="Search exercises" value="${esc(sh.query || "")}" data-input="exSearch" autocomplete="off"></div>
      <div class="chips"><button class="chip ${!sh.muscle ? "on" : ""}" data-action="exMuscle" data-m="">All</button>${muscles.map((m) => `<button class="chip ${sh.muscle === m ? "on" : ""}" data-action="exMuscle" data-m="${esc(m)}">${esc(m)}</button>`).join("")}</div>
      <div id="exlist">${this._pickerList(sh)}</div>
      <details class="newex"><summary>Create custom exercise</summary><div class="form">
        <label>Name<input data-nx="name"></label>
        <div class="grid2"><label>Muscle group<input data-nx="muscle" placeholder="e.g. Chest"></label>
        <label>Equipment<input data-nx="equipment" placeholder="e.g. Cable"></label></div>
        <label>Tracks<select data-nx="kind"><option value="weight_reps">Weight & reps</option><option value="bodyweight_reps">Bodyweight reps</option><option value="duration">Time</option><option value="distance">Distance & time</option></select></label>
        <label>Type (for calories)<select data-nx="tier"><option value="1">Heavy full-body lift (squat, deadlift)</option><option value="2">Compound (bench, rows, pull-ups)</option><option value="3" selected>Machine or supported compound (leg press, lunges)</option><option value="4">Isolation (curls, raises, extensions)</option></select></label>
        <button class="btn primary full" data-action="createExercise">Create & add</button></div></details>`;
  }

  /* An iOS-style action sheet. items: [{label, icon, run, danger, sub, swatch, on}] */
  async _openAddFood(meal) {
    const sh = { kind: "addFood", meal, mode: "search", query: "" };
    this._openSheet(sh);
    Object.assign(sh, await this.ws("food/recent"));
    if (this._sheet === sh && !sh.query) this._updateFoodResults();
  }

  /** The phone's centre button on the Nutrition tab: you're usually there to log food. */
  _centerMenu() {
    const meal = mealForNow();
    const go = async () => {
      const s = this._s;
      s.tab = "workout"; localStorage.setItem("ha-health-tab", s.tab); s.sheets = [];
      this._render(); this.shadowRoot.getElementById("content").scrollTop = 0;
      await this._loadTab(); this._render();
    };
    this._actionSheet("What would you like to do?", [
      { label: "Log food", sub: `Adds to ${cap(meal)}`, icon: "mdi:food-apple-outline", run: () => this._openAddFood(meal) },
      this._s.active
        ? { label: "Back to workout", sub: this._s.active.name || "In progress", icon: "mdi:dumbbell", run: go }
        : { label: "Start workout", icon: "mdi:dumbbell", run: go },
    ]);
  }

  _actionSheet(title, items, subtitle = "") {
    this._openSheet({ kind: "menu", title, subtitle, items });
  }
  _sheetMenu(sh) {
    return `${sh.title ? `<h2>${esc(sh.title)}</h2>` : ""}${sh.subtitle ? `<div class="muted small">${esc(sh.subtitle)}</div>` : ""}
      <div class="menu">${sh.items.map((it, i) => `<button class="menuitem ${it.danger ? "danger" : ""} ${it.on ? "on" : ""}" data-action="menuItem" data-i="${i}">
        ${it.swatch ? `<span class="setbadge ${it.swatch}">${it.swatchText}</span>` : it.icon ? icon(it.icon) : ""}
        <span class="mlabel">${esc(it.label)}${it.sub ? `<span class="muted small">${esc(it.sub)}</span>` : ""}</span>
        ${it.on ? icon("mdi:check", "accent") : ""}</button>`).join("")}</div>`;
  }

  /* ============================================================== sheets */
  _openSheet(sh) { this._s.sheets.push(sh); this._renderSheet(true); }
  _closeSheet() {
    const sh = this._s.sheets.pop();
    sh?.onClose?.();
    this._renderSheet();
  }
  get _sheet() { return this._s.sheets[this._s.sheets.length - 1]; }

  _renderSheet(animate = false) {
    const el = this.shadowRoot.getElementById("sheet");
    if (!el) return;
    const sh = this._sheet;
    if (!sh) { el.innerHTML = ""; return; }
    let body = "";
    switch (sh.kind) {
      case "html": body = sh.html; break;
      case "menu": body = this._sheetMenu(sh); break;
      case "addFood": body = this._sheetAddFood(sh); break;
      case "portion": body = this._sheetPortion(sh); break;
      case "vital": body = this._sheetVital(sh); break;
      case "profile": body = this._sheetProfile(); break;
      case "targets": body = this._sheetTargets(); break;
      case "workoutSettings": body = this._sheetWorkoutSettings(sh); break;
      case "import": body = this._sheetImport(sh); break;
      case "template": body = this._sheetTemplate(sh); break;
      case "picker": body = this._sheetPicker(sh); break;
      case "effort": body = `<h2>How hard was that set?</h2><div class="muted small">${esc(sh.subtitle)}</div>
        <div class="menu">${EFFORT.map(([v, l, d]) => `<button class="menuitem effort" data-action="effort" data-v="${v}"><span class="rpebig e${v}">${v}</span><span class="mlabel">${l}<span class="muted small">${d}</span></span></button>`).join("")}</div>
        <button class="btn ghost full" data-action="effort" data-v="">Skip</button>`; break;
      case "confirm": body = `<h2 class="${sh.warn ? "warntitle" : ""}">${sh.warn ? icon("mdi:alert") + " " : ""}${esc(sh.title)}</h2><p>${esc(sh.text)}</p><div class="actions"><button class="btn ${sh.warn ? "primary" : ""}" data-action="confirmNo">${esc(sh.cancel || "Cancel")}</button><button class="btn ${sh.danger ? "danger" : sh.warn ? "" : "primary"}" data-action="confirmYes">${esc(sh.ok)}</button></div>`; break;
    }
    const prevScroll = animate ? 0 : el.querySelector(".sheetbody")?.scrollTop || 0;
    el.innerHTML = `<div class="scrim" data-action="closeSheet"></div>
      <div class="sheet ${animate ? "anim" : ""}" role="dialog" aria-modal="true">
        <div class="grabzone"><div class="grab"></div></div>
        <button class="iconbtn close" data-action="closeSheet" aria-label="Close">${icon("mdi:close")}</button>
        <div class="sheetbody">${body}</div></div>`;
    el.querySelector(".sheetbody").scrollTop = prevScroll;
  }

  /* Swipe a sheet down to dismiss (from the grab handle, or anywhere when scrolled to the top). */
  _dragStart(e) {
    const sheet = e.target.closest?.(".sheet");
    if (!sheet || !this._narrow || e.target.closest("input,select,textarea")) return;
    const body = sheet.querySelector(".sheetbody");
    if (!e.target.closest(".grabzone") && body.scrollTop > 0) return;
    this._drag = { sheet, y0: e.touches[0].clientY, dy: 0 };
  }
  _dragMove(e) {
    const d = this._drag;
    if (!d) return;
    d.dy = Math.max(0, e.touches[0].clientY - d.y0);
    if (d.dy > 4) { e.preventDefault(); d.sheet.style.transition = "none"; d.sheet.style.transform = `translateY(${d.dy}px)`; }
  }
  _dragEnd() {
    const d = this._drag;
    this._drag = null;
    if (!d) return;
    if (d.dy > 110) {
      d.sheet.style.transition = "transform .18s ease-in"; d.sheet.style.transform = "translateY(100%)";
      setTimeout(() => this._act("closeSheet", d.sheet, null), 170);
    } else { d.sheet.style.transition = "transform .18s"; d.sheet.style.transform = ""; }
  }

  _confirm(title, text, ok = "OK", danger = false, cancel = "Cancel", warn = false) {
    return new Promise((resolve) => this._openSheet({ kind: "confirm", title, text, ok, danger, cancel, warn, resolve, onClose: () => resolve(false) }));
  }

  /** Warn (but allow) when a plan means eating more than 600 kcal/day below maintenance. */
  async _deficitOk(deficit) {
    if (!(deficit > MAX_SAFE_DEFICIT)) return true;
    return this._confirm("Warning!", `This works out to a deficit of about ${r0(deficit)} kcal/day. ${DEFICIT_WARNING}`,
      "Keep it anyway", false, "Change it", true);
  }

  _toast(msg, err = false) {
    const el = this.shadowRoot.getElementById("toast");
    if (!el) return;
    el.innerHTML = `<div class="toast ${err ? "err" : ""}">${esc(msg)}</div>`;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (el.innerHTML = ""), 2600);
  }

  _exName(id) { return this._exMap?.[id]?.name || id; }

  /* ===================================================== workout helpers */
  _exerciseMenu(ei) {
    const s = this._s, ex = s.active.exercises[ei];
    const name = this._exName(ex.exercise_id);
    this._actionSheet(name, [
      { label: "Add warm-up set", icon: "mdi:fire", run: () => {
        const at = ex.sets.findIndex((x) => x.type !== "warmup");
        ex.sets.splice(at === -1 ? ex.sets.length : at, 0, blankSet("warmup"));
        this._queueWorkoutSave(); this._render();
      } },
      { label: "Update rest timer", sub: fmtRest(ex.rest_s ?? 120), icon: "mdi:timer-outline", run: () => this._restMenu(ei) },
      { label: "Replace exercise", icon: "mdi:swap-horizontal", run: () => this._openPicker("Replace exercise", async (id) => {
        ex.exercise_id = id;
        await this._loadLast([id]);
        ex.rest_s = s.last[id]?.rest_s ?? ex.rest_s;
        this._queueWorkoutSave(); this._render();
      }) },
      ex.superset
        ? { label: "Remove from superset", icon: "mdi:link-variant-off", run: () => { this._leaveSuperset(ex); this._queueWorkoutSave(); this._render(); } }
        : { label: "Create superset", icon: "mdi:link-variant", run: () => this._supersetMenu(ei) },
      { label: "Remove exercise", icon: "mdi:delete-outline", danger: true, run: async () => {
        if (!(await this._confirm("Remove exercise?", `Remove ${name} and its sets from this workout?`, "Remove", true))) return;
        this._leaveSuperset(ex);
        s.active.exercises.splice(s.active.exercises.indexOf(ex), 1);
        this._queueWorkoutSave(); this._render();
      } },
    ]);
  }

  _restMenu(ei) {
    const ex = this._s.active.exercises[ei];
    const cur = ex.rest_s ?? 120;
    this._actionSheet(`Rest timer · ${this._exName(ex.exercise_id)}`, REST_OPTIONS.map((v) => ({
      label: fmtRest(v), on: v === cur, run: () => { ex.rest_s = v; this._queueWorkoutSave(); this._render(); },
    })));
  }

  _supersetMenu(ei) {
    const s = this._s, ex = s.active.exercises[ei];
    const others = s.active.exercises.filter((o) => o !== ex);
    const join = (other) => {
      const id = other.superset || rid();
      other.superset = id; ex.superset = id;
      // Keep superset partners next to each other: move this exercise after the group's last member.
      const list = s.active.exercises;
      list.splice(list.indexOf(ex), 1);
      let at = -1;
      list.forEach((o, i) => { if (o.superset === id) at = i; });
      list.splice(at + 1, 0, ex);
      this._queueWorkoutSave(); this._render();
    };
    this._actionSheet("Superset with…", [
      ...others.map((o) => ({ label: this._exName(o.exercise_id), icon: "mdi:dumbbell", sub: o.superset ? "Already in a superset — joins it" : "", run: () => join(o) })),
      { label: "Add a new exercise", icon: "mdi:plus", run: () => this._openPicker("Superset with…", async (id) => {
        join(await this._addExercise(id));
      }) },
    ], "Sets alternate between exercises; rest starts after the last exercise in the superset.");
  }

  _leaveSuperset(ex) {
    const id = ex.superset;
    if (!id) return;
    ex.superset = null;
    const rest = this._s.active.exercises.filter((o) => o.superset === id);
    if (rest.length === 1) rest[0].superset = null;
  }

  _openPicker(title, onPick) { this._openSheet({ kind: "picker", title, query: "", muscle: "", onPick }); }

  async _addExercise(id) {
    await this._loadLast([id]);
    const last = this._s.last[id];
    const count = Math.max(3, (last?.sets || []).filter((x) => x.type !== "warmup").length || 3);
    const ex = { id: rid(), exercise_id: id, notes: "", rest_s: last?.rest_s ?? this._s.overview.profile.rest_default_s ?? 120, superset: null,
      sets: Array.from({ length: count }, () => blankSet()) };
    this._s.active.exercises.push(ex);
    this._queueWorkoutSave();
    return ex;
  }

  _setMenu(ei, si) {
    const ex = this._s.active.exercises[ei], x = ex.sets[si];
    const items = Object.entries(SET_TYPES).map(([k, t]) => ({
      label: t.label, swatch: t.cls, swatchText: t.short || "1", on: x.type === k,
      run: () => { x.type = k; this._queueWorkoutSave(); this._render(); },
    }));
    items.push({ label: "Remove set", icon: "mdi:delete-outline", danger: true, run: () => { ex.sets.splice(si, 1); this._queueWorkoutSave(); this._render(); } });
    this._actionSheet(`Set ${si + 1} · ${this._exName(ex.exercise_id)}`, items);
  }

  async _completeSet(ei, si) {
    const s = this._s, ex = s.active.exercises[ei], x = ex.sets[si];
    const kind = this._exMap[ex.exercise_id]?.kind || "weight_reps";
    const prev = prevFor(s.last[ex.exercise_id], ex.sets, si);
    // An empty field accepts last time's number (shown as the placeholder).
    for (const k of ["weight", "reps", "duration_s", "distance_m"]) if (x[k] == null && prev?.[k] != null) x[k] = prev[k];
    const missing = kind === "duration" ? x.duration_s == null : kind === "distance" ? x.distance_m == null : x.reps == null;
    if (missing) { this._toast(kind === "duration" ? "Enter a time first" : kind === "distance" ? "Enter a distance first" : "Enter reps first", true); this._render(); return; }
    const rpe = await new Promise((resolve) => this._openSheet({ kind: "effort", subtitle: `${this._exName(ex.exercise_id)} · ${this._setText(ex.exercise_id, x)}`, resolve, onClose: () => resolve(undefined) }));
    if (rpe === undefined) { this._render(); return; } // dismissed: leave the set unchecked
    x.rpe = rpe; x.completed = true;
    x.completed_at = new Date().toISOString(); // real rest lengths feed the calorie estimate
    this._queueWorkoutSave();
    // Supersets: only rest after the last exercise in the group.
    const group = ex.superset ? s.active.exercises.filter((o) => o.superset === ex.superset) : [ex];
    const isLast = group[group.length - 1] === ex;
    // An all-out set (effort 10 or a failure set) gets at least 3 minutes, never less than the
    // exercise's own rest. In a superset, any all-out set in this round counts.
    const allOut = (o) => o && o.completed && (o.rpe === 10 || o.type === "failure");
    const hard = group.some((o) => allOut(o === ex ? x : o.sets[si]));
    const baseS = ex.rest_s ?? 120;
    const restS = hard && baseS > 0 ? Math.max(baseS, HARD_SET_REST_S) : baseS;
    if (x.type !== "warmup" && isLast && restS > 0) {
      const nx = this._nextSet(ei);
      this._setRest({ ends_at: now() + restS, total: restS, exercise_id: nx?.exercise_id ?? ex.exercise_id, next: nx?.label ?? null });
      if (restS > baseS) this._toast(`All-out set — resting ${fmtRest(restS)}`);
    } else if (!isLast) {
      this._toast(`Next: ${this._exName(group[group.indexOf(ex) + 1].exercise_id)}`);
    }
    this._render();
  }

  /** The next unchecked set, e.g. "Bench Press · Set 3 · 185 lb × 8" (shown on the rest bar and iPhone). */
  _nextSet(ei) {
    const s = this._s, list = s.active.exercises, cur = list[ei];
    // In a superset the next set is back at the group's first exercise.
    let start = ei;
    if (cur.superset) start = list.findIndex((o) => o.superset === cur.superset);
    const order = [...list.slice(start), ...list.slice(0, start)];
    for (const ex of order) {
      const si = ex.sets.findIndex((x) => !x.completed);
      if (si === -1) continue;
      const x = ex.sets[si];
      const prev = prevFor(s.last[ex.exercise_id], ex.sets, si);
      const merged = { ...x };
      for (const k of ["weight", "reps", "duration_s", "distance_m"]) if (merged[k] == null && prev?.[k] != null) merged[k] = prev[k];
      const n = ex.sets.slice(0, si + 1).filter((y) => y.type === "working").length;
      const setName = x.type === "working" ? `Set ${n}` : SET_TYPES[x.type].label;
      const kind = this._exMap[ex.exercise_id]?.kind;
      const hasNums = kind === "duration" ? merged.duration_s != null : kind === "distance" ? merged.distance_m != null : merged.reps != null || merged.weight != null;
      const nums = hasNums ? ` · ${this._setText(ex.exercise_id, merged).replace(/^– lb × |^– kg × /, "")}` : "";
      return { exercise_id: ex.exercise_id, label: `${this._exName(ex.exercise_id)} · ${setName}${nums}` };
    }
    return null;
  }

  /* ============================================================== events */
  _onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    this._act(el.dataset.action, el, e);
  }

  async _act(action, el) {
    const s = this._s, d = el?.dataset || {};
    try {
      switch (action) {
        case "menu": this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true })); break;
        case "tab":
          if (d.center && s.tab === "nutrition") { this._centerMenu(); break; }
          s.tab = d.tab; localStorage.setItem("ha-health-tab", s.tab); s.sheets = [];
          this._render(); this.shadowRoot.getElementById("content").scrollTop = 0;
          await this._loadTab(); this._render();
          break;
        case "closeSheet": this._closeSheet(); break;
        case "confirmYes": { const sh = s.sheets.pop(); this._renderSheet(); sh.resolve(true); break; }
        case "confirmNo": this._closeSheet(); break;
        case "menuItem": { const sh = s.sheets.pop(); this._renderSheet(); await sh.items[+d.i].run(); break; }
        case "effort": { const sh = s.sheets.pop(); this._renderSheet(); sh.resolve(d.v === "" ? null : Number(d.v)); break; }

        /* history */
        case "historyMode": s.historyMode = d.mode; this._render(); await this._loadTab(); this._render(); break;
        case "moreWorkouts": {
          const res = await this.ws("workout/list", { offset: s.workouts.length, limit: 20 });
          s.workouts = s.workouts.concat(res.items); s.workoutsTotal = res.total; this._render(); break;
        }
        case "openWorkout": this._openSheet({ kind: "html", html: this._sheetWorkout(s.workouts.find((x) => x.id === d.id)) }); break;
        case "openExercise": {
          const sh = { kind: "html", html: `<h2>${esc(this._exName(d.id))}</h2><p class="muted">Loading…</p>` };
          this._openSheet(sh);
          sh.html = await this._sheetExerciseHtml(d.id);
          if (this._sheet === sh) this._renderSheet();
          break;
        }
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
          if (!(await this._confirm("Finish workout?", incomplete ? "Sets that aren't checked off will be dropped." : "Nice work!", "Finish"))) break;
          const w = await this.ws("workout/finish");
          s.active = null; s.workouts = null; s.records = null; s.last = {};
          await this._refreshOverview();
          s.tab = "history"; localStorage.setItem("ha-health-tab", "history");
          await this._loadTab(); this._render();
          this._openSheet({ kind: "html", html: this._sheetWorkout(w) });
          const kc = w.summary?.kcal_active != null ? ` · ${r0(w.summary.kcal_active)} kcal` : "";
          this._toast(prCount(w) ? `Workout saved${kc} — ${prCount(w)} new PR${prCount(w) > 1 ? "s" : ""}! 🏆` : `Workout saved${kc}`);
          break;
        }
        case "discardWorkout":
          if (!(await this._confirm("Discard workout?", "Everything logged in this workout will be lost.", "Discard", true))) break;
          clearTimeout(this._saveTimer); this._saveTimer = null;
          await this.ws("workout/discard"); s.active = null; this._render(); break;
        case "addExercise": this._openPicker("Add exercise", async (id) => { await this._addExercise(id); this._render(); }); break;
        case "pickExercise": { const sh = this._sheet; s.sheets.pop(); this._renderSheet(); await sh.onPick(d.id); break; }
        case "exMuscle": this._sheet.muscle = d.m; this._renderSheet(); break;
        case "createExercise": {
          const get = (k) => this.shadowRoot.querySelector(`[data-nx="${k}"]`)?.value;
          const ex = await this.ws("exercises/create", { exercise: { name: get("name"), muscle: get("muscle"), equipment: get("equipment"), kind: get("kind"), tier: Number(get("tier")) } });
          s.exercises.push(ex); this._exMap[ex.id] = ex;
          const sh = this._sheet; s.sheets.pop(); this._renderSheet(); await sh.onPick(ex.id); break;
        }
        case "exMenu": this._exerciseMenu(+d.e); break;
        case "setMenu": this._setMenu(+d.e, +d.s); break;
        case "addSet": {
          const ex = s.active.exercises[+d.e];
          const lastSet = [...ex.sets].reverse().find((x) => x.type !== "warmup");
          ex.sets.push(blankSet(lastSet && lastSet.type !== "working" ? lastSet.type : "working", lastSet));
          this._queueWorkoutSave(); this._render(); break;
        }
        case "usePrev": {
          const ex = s.active.exercises[+d.e];
          const prev = prevFor(s.last[ex.exercise_id], ex.sets, +d.s);
          if (!prev) break;
          Object.assign(ex.sets[+d.s], { weight: prev.weight, reps: prev.reps, duration_s: prev.duration_s, distance_m: prev.distance_m, autofill: false, autofill_w: false });
          this._queueWorkoutSave(); this._render(); break;
        }
        case "toggleSet": {
          const x = s.active.exercises[+d.e].sets[+d.s];
          if (x.completed) { x.completed = false; x.rpe = null; x.completed_at = null; this._queueWorkoutSave(); this._render(); }
          else await this._completeSet(+d.e, +d.s);
          break;
        }
        case "restAdj": {
          const r = s.active?.rest; if (!r) break;
          const ends = r.ends_at + +d.d;
          if (ends <= now()) { this._setRest(null); break; }
          this._setRest({ ...r, ends_at: ends, total: Math.max(1, r.total + +d.d) }); break;
        }
        case "restSkip": this._setRest(null); break;

        /* templates */
        case "newTemplate": this._openSheet({ kind: "template", tpl: { name: "", exercises: [] } }); break;
        case "editTemplate": this._openSheet({ kind: "template", tpl: structuredClone(s.templates.find((t) => t.id === d.id)) }); break;
        case "deleteTemplate":
          if (!(await this._confirm("Delete template?", "Past workouts aren't affected.", "Delete", true))) break;
          await this.ws("templates/delete", { template_id: d.id }); s.templates = await this.ws("templates/list"); this._render(); break;
        case "tplAddExercise": {
          const tsh = this._sheet;
          this._openPicker("Add exercise", (id) => {
            tsh.tpl.exercises.push({ exercise_id: id, sets: [1, 2, 3].map(() => ({ type: "working", reps: 10, weight: null })) });
            this._renderSheet();
          });
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
        case "addFood": await this._openAddFood(d.meal); break;
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
          s.sheets = []; await this._reloadFood(); this._render();
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
          this._openSheet({ kind: "portion", food, amount: e.amount, unit: e.unit === "quick" ? "serving" : e.unit, meal: e.meal, editId: e.id });
          break;
        }
        case "deleteFood":
          await this.ws("food/delete", { entry_id: d.id });
          s.sheets = []; await this._reloadFood(); this._render(); this._toast("Entry deleted"); break;
        case "quickAdd": {
          const get = (k) => this.shadowRoot.querySelector(`[data-q="${k}"]`)?.value;
          if (!num(get("kcal")) && !num(get("protein")) && !num(get("carbs")) && !num(get("fat"))) { this._toast("Enter at least calories", true); break; }
          await this.ws("food/log", { entry: { date: s.day, meal: this._sheet.meal, name: get("name") || "Quick add", amount: 1, unit: "quick",
            kcal: num(get("kcal")) || 0, protein: num(get("protein")) || 0, carbs: num(get("carbs")) || 0, fat: num(get("fat")) || 0, remember: false } });
          s.sheets = []; await this._reloadFood(); this._render(); this._toast("Added"); break;
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
        case "openVital": {
          const sh = { kind: "vital", type: d.type, list: null };
          this._openSheet(sh);
          sh.list = await this.ws("vitals/list", { vital_type: d.type, limit: 30 });
          if (this._sheet === sh) this._renderSheet();
          break;
        }
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
        case "stepsInfo": {
          const st = s.overview.steps || {};
          const rows = Object.entries(st.history || {}).reverse().map(([d, v]) => `<div class="histrow row between"><span>${fmtDate(d + "T12:00:00")}</span><b>${r0(v)}</b></div>`).join("");
          this._openSheet({ kind: "html", html: `<h2>${icon("mdi:walk")} Steps</h2>
            <div class="egrid"><div><div class="muted small">Today</div><div class="big">${st.today != null ? r0(st.today) : "–"}</div></div>
            <div><div class="muted small">14-day avg</div><div class="big">${st.avg != null ? r0(st.avg) : "–"}</div></div>
            <div><div class="muted small">Used for calories</div><div class="big">${r0(st.used)}</div></div></div>
            <p class="muted small">${st.sensor ? (st.source === "tracked" ? "Maintenance calories use your tracked average." : `Maintenance calories use the steps from setup until 3 days are tracked (${st.days} so far).`) : "No step counter connected. Pick one in Profile → iPhone, rest timer & Apple Health."}</p>
            ${rows ? `<h3>Recent days</h3>${rows}` : ""}` });
          break;
        }
        case "importOpen": {
          const st = await this.ws("import/status", { source: "strong" });
          this._openSheet({ kind: "import", result: null, imported: st.count });
          break;
        }
        case "importRun": {
          const sh = this._sheet;
          sh.busy = `Importing ${sh.result.new_workouts} workouts…`; this._renderSheet();
          sh.result = await this.ws("import/strong", { csv: sh.csv, dry_run: false });
          sh.busy = null; sh.imported += sh.result.new_workouts;
          s.workouts = null; s.records = null; s.last = {};
          await this._refreshOverview(); this._renderSheet(); this._render();
          break;
        }
        case "importUndo": {
          const sh = this._sheet;
          if (!(await this._confirm("Remove imported workouts?", `This deletes the ${sh.imported} workouts that came from Strong. Workouts you logged in Health Assistant aren't touched.`, "Remove", true))) break;
          const r = await this.ws("import/undo", { source: "strong" });
          sh.imported = 0; sh.result = null;
          s.workouts = null; s.records = null; s.last = {};
          await this._refreshOverview(); this._renderSheet(); this._render();
          this._toast(`Removed ${r.removed} imported workouts`); break;
        }
        case "editProfile": this._openSheet({ kind: "profile" }); break;
        case "editTargets": this._openSheet({ kind: "targets" }); this._updateMacroKcal(); break;
        case "saveTargets": case "resetTargets": {
          const keys = ["calorie_target_override", "protein_override_g", "carbs_override_g", "fat_override_g"];
          const changes = {};
          keys.forEach((k) => (changes[k] = action === "resetTargets" ? null : num(this.shadowRoot.querySelector(`[data-t="${k}"]`).value)));
          if (changes.calorie_target_override && !(await this._deficitOk(s.overview.energy.maintenance - changes.calorie_target_override))) break;
          await this.ws("profile/update", { changes });
          s.sheets = []; await this._loadAll(); this._render(); this._toast(action === "resetTargets" ? "Using calculated targets" : "Targets saved"); break;
        }
        case "workoutSettings": {
          const sh = { kind: "workoutSettings", targets: null, sensors: [] };
          this._openSheet(sh);
          [sh.targets, sh.sensors] = await Promise.all([this.ws("notify/targets"), this.ws("steps/sensors")]);
          if (this._sheet === sh) this._renderSheet();
          break;
        }
        case "testLive": {
          const svc = this.shadowRoot.querySelector('[data-ws="live_activity_notify"]').value;
          if (!svc) { this._toast("Pick your phone first", true); break; }
          const r = await this.ws("live/test", { service: svc });
          this._toast(`Test sent to ${r.sent_to} — check your Lock Screen`); break;
        }
        case "testSound": {
          const svc = this.shadowRoot.querySelector('[data-ws="live_activity_notify"]').value;
          const sound = this.shadowRoot.querySelector('[data-ws="rest_sound"]').value;
          if (!svc) { this._toast("Pick your phone first", true); break; }
          if (sound === "off") { this._toast("Sound is off — pick Chime or Default first", true); break; }
          const r = await this.ws("live/test_sound", { service: svc, sound });
          this._toast(`Sound sent to ${r.sent_to}`); break;
        }
        case "saveWorkoutSettings": {
          const el = (k) => this.shadowRoot.querySelector(`[data-ws="${k}"]`);
          const get = (k) => el(k).value;
          await this.ws("profile/update", { changes: {
            rest_default_s: Number(get("rest_default_s")), live_activity_notify: get("live_activity_notify") || null,
            rest_sound: get("rest_sound"),
            steps_sensor: get("steps_sensor") || null, apple_health_export: el("apple_health_export").checked,
            apple_health_shortcut: get("apple_health_shortcut").trim() || null,
          } });
          s.sheets = []; await this._refreshOverview(); this._render(); this._toast("Saved"); break;
        }
        case "saveProfile": {
          const get = (k) => this.shadowRoot.querySelector(`[data-p="${k}"]`)?.value;
          const nu = new Units(this._units.imp ? "imperial" : "metric");
          const changes = {
            name: get("name"), units: get("units"), sex: get("sex"), age: num(get("age")),
            target_weight_kg: nu.wIn(get("target")), daily_steps: num(get("steps")), lifting_days: num(get("lift")),
            goal_rate_kg_week: nu.wIn(get("rate")),
          };
          const curH = s.overview.latest.height?.value ?? s.overview.profile.height_cm;
          const h = nu.imp ? ((num(get("ft")) || 0) * 12 + (num(get("in")) || 0)) * 2.54 : num(get("cm"));
          if (h && Math.abs(h - curH) > 0.6) changes.height_cm = Math.round(h * 10) / 10;
          const losing = (s.overview.latest.weight?.value ?? 0) - changes.target_weight_kg >= 0.5;
          if (losing && !s.overview.profile.calorie_target_override
              && !(await this._deficitOk((changes.goal_rate_kg_week || 0) * 7700 / 7))) break;
          if (s.overview.energy?.lifting?.active) delete changes.lifting_days;
          if (s.overview.energy?.steps_source === "tracked") delete changes.daily_steps;
          await this.ws("profile/update", { changes });
          s.sheets = []; await this._loadAll(); this._render(); this._toast("Profile saved"); break;
        }
      }
    } catch (err) {
      console.error(err);
      this._toast(err.message || String(err), true);
    }
  }

  _updateMacroKcal() {
    const el = this.shadowRoot.getElementById("macrokcal");
    if (!el) return;
    const e = this._s.overview.energy;
    const auto = e.macros_auto || {};
    const field = (k) => num(this.shadowRoot.querySelector(`[data-t="${k}"]`)?.value);
    const kc = field("calorie_target_override") ?? e.target_auto;
    const p = field("protein_override_g") ?? auto.protein_g;
    const f = field("fat_override_g") ?? (field("calorie_target_override") ? kc * 0.25 / 9 : auto.fat_g);
    const c = field("carbs_override_g");
    el.textContent = c != null
      ? `These macros add up to ${r0(p * 4 + c * 4 + f * 9)} kcal (target ${r0(kc)}).`
      : `Carbs will fill the rest: about ${r0(Math.max(0, (kc - p * 4 - f * 9) / 4))} g.`;
  }

  _onInput(e) {
    const t = e.target, d = t.dataset, s = this._s;
    if (d.set !== undefined && s.active) {
      const ex = s.active.exercises[+d.e];
      const x = ex.sets[+d.s];
      const v = t.value;
      const u = this._units;
      // Weight and reps fill down into later sets that are still blank (or were filled this way).
      const fillDown = (field, flag, display) => {
        x[flag] = false;
        ex.sets.forEach((y, j) => {
          if (j <= +d.s || y.completed || y.type === "warmup" || !(y[field] == null || y[flag])) return;
          y[field] = x[field]; y[flag] = x[field] != null;
          const inp = this.shadowRoot.querySelector(`input[data-set="${field}"][data-e="${d.e}"][data-s="${j}"]`);
          if (inp) inp.value = display;
        });
      };
      if (d.set === "weight") { x.weight = u.wIn(v); fillDown("weight", "autofill_w", v); }
      else if (d.set === "reps") { x.reps = v === "" ? null : parseInt(v, 10); fillDown("reps", "autofill", x.reps ?? ""); }
      else if (d.set === "duration_s") x.duration_s = v === "" ? null : parseInt(v, 10);
      else if (d.set === "minutes") x.duration_s = v === "" ? null : Math.round(Number(v) * 60);
      else if (d.set === "distance") x.distance_m = u.dIn(v);
      this._queueWorkoutSave();
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
      this._sheet.query = t.value;
      this.shadowRoot.getElementById("exlist").innerHTML = this._pickerList(this._sheet);
    } else if (d.tplreps !== undefined) {
      this._sheet.tpl.exercises[+d.tplreps].sets.forEach((x) => { if (x.type !== "warmup") x.reps = num(t.value); });
    } else if (d.t !== undefined) {
      this._updateMacroKcal();
    }
  }

  _updateFoodResults() {
    const el = this.shadowRoot.getElementById("foodresults");
    if (el) el.innerHTML = this._foodResults(this._sheet);
  }

  async _onChange(e) {
    const t = e.target, d = t.dataset, s = this._s;
    if (d.change === "portionUnit") {
      const sh = this._sheet, f = sh.food;
      const g = portion(f, sh.amount, sh.unit).grams;
      if (g) sh.amount = t.value === "g" ? Math.round(g) : t.value === "oz" ? Math.round((g / OZ_G) * 10) / 10 : Math.round((g / (f.serving_g || 100)) * 100) / 100;
      sh.unit = t.value; this._renderSheet();
    } else if (d.change === "portionMeal") this._sheet.meal = t.value;
    else if (d.change === "importFile") {
      const sh = this._sheet, file = t.files?.[0];
      if (!file) return;
      sh.busy = `Reading ${file.name}…`; sh.error = null; this._renderSheet();
      try {
        sh.csv = await file.text();
        sh.result = await this.ws("import/strong", { csv: sh.csv, dry_run: true });
      } catch (err) { sh.error = err.message || String(err); }
      sh.busy = null; this._renderSheet();
    }
    else if (d.change === "profile") {
      s.profileId = t.value; localStorage.setItem("ha-health-profile", t.value);
      s.workouts = null; s.records = null; s.last = {}; s.loading = true; this._render();
      await this._loadAll(); s.loading = false; this._render();
    }
  }
}

/* ------------------------------------------------------------- charts */
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
:host { display:block; height:100%; overflow:hidden; --hp-accent: var(--primary-color, #03a9f4); --hp-good:#34c759; --hp-bad: var(--error-color, #ff3b30);
  --hp-card: var(--ha-card-background, var(--card-background-color, #fff)); --hp-text: var(--primary-text-color, #212121); --hp-muted: var(--secondary-text-color, #727272);
  --hp-line: var(--divider-color, rgba(0,0,0,.12)); --hp-bg: var(--primary-background-color, #f2f2f7); --hp-fill: color-mix(in srgb, var(--hp-text) 6%, transparent);
  --hp-radius: 14px; --warm:#f5b400; --drop:#8e5cd9; --fail:#ff3b30;
  color: var(--hp-text); font: 15px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; -webkit-text-size-adjust:100%; }
* { box-sizing:border-box; }
button { font:inherit; color:inherit; background:none; border:0; cursor:pointer; padding:0; touch-action:manipulation; }
input, select, textarea { font:inherit; font-size:16px; color:var(--hp-text); background:var(--hp-fill); border:1px solid transparent; border-radius:10px; padding:10px 12px; width:100%; }
input:focus, select:focus, textarea:focus { outline:none; border-color:var(--hp-accent); background:var(--hp-card); }
input::placeholder { color:var(--hp-muted); opacity:.7; }
ha-icon { --mdc-icon-size: 20px; display:inline-flex; vertical-align:middle; }
h1 { font-size:1.9rem; font-weight:700; margin:0; letter-spacing:-.02em; }
h2 { margin:0 0 4px; font-size:1.25rem; font-weight:650; } h3 { margin:14px 0 8px; font-size:1rem; font-weight:600; }

/* ---------- shell ---------- */
.app { display:flex; flex-direction:column; height:100vh; height:100dvh; background:var(--hp-bg); position:relative; overflow:hidden; }
/* Phones: pin the app to the visible screen so only the content scrolls, never the page. */
.app.narrow { position:fixed; left:0; right:0; top:var(--vvtop, 0px); height:var(--vvh, 100dvh); overscroll-behavior:none; }
.app.narrow.kb .bottomnav { display:none; }
main { flex:1 1 auto; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior-y:contain; }
.wrap { max-width:720px; margin:0 auto; padding:16px 16px 28px; }
.wrap.widewrap { max-width:1180px; }
.narrow .wrap { padding:calc(10px + env(safe-area-inset-top)) 12px 20px; min-height:calc(100% + 1px); }
/* ^ Keeps the content area scrollable even when a page is nearly empty. Otherwise iOS
   hands the swipe to the page behind the panel, which bounces the whole app. */
.top { display:flex; align-items:center; gap:8px; padding:0 16px; height:56px; flex:0 0 auto; background:var(--app-header-background-color, var(--hp-card)); color:var(--app-header-text-color, var(--hp-text)); border-bottom:1px solid var(--hp-line); }
.narrow .top { display:none; }
.title { display:flex; align-items:center; gap:8px; font-size:1.2rem; font-weight:500; }
.brand { --mdc-icon-size:24px; }
.spacer { flex:1; }
.profilesel { width:auto; padding:6px 28px 6px 10px; font-size:14px; }
.top .profilesel { background:transparent; color:inherit; border:1px solid color-mix(in srgb, currentColor 30%, transparent); }
.topnav { display:flex; gap:4px; margin-left:12px; }
.topnav .navbtn { display:flex; align-items:center; gap:6px; padding:7px 14px; border-radius:18px; opacity:.75; }
.topnav .navbtn:hover { opacity:1; background:color-mix(in srgb, currentColor 10%, transparent); }
.topnav .navbtn.on { opacity:1; background:color-mix(in srgb, currentColor 16%, transparent); font-weight:600; }
.topnav .navbtn.center { opacity:1; background:var(--hp-accent); color:var(--text-primary-color,#fff); }
.pagehead { display:none; align-items:center; justify-content:space-between; gap:8px; margin:6px 4px 12px; }
.narrow .pagehead { display:flex; }

/* bottom tab bar (phones) */
.bottomnav { display:none; flex:0 0 auto; grid-template-columns:repeat(5,1fr); align-items:end;
  background:color-mix(in srgb, var(--hp-card) 92%, transparent); -webkit-backdrop-filter:saturate(180%) blur(20px); backdrop-filter:saturate(180%) blur(20px);
  border-top:.5px solid var(--hp-line); padding:4px 0 max(6px, env(safe-area-inset-bottom)); }
.narrow .bottomnav { display:grid; }
.bottomnav .navbtn { display:flex; flex-direction:column; align-items:center; gap:2px; padding:2px 0; color:var(--hp-muted); font-size:10px; font-weight:500; min-height:46px; justify-content:flex-end; }
.bottomnav .navbtn ha-icon { --mdc-icon-size:25px; }
.bottomnav .navbtn.on { color:var(--hp-accent); }
.bottomnav .navbtn.center .navicon { width:44px; height:44px; margin-top:-10px; border-radius:50%; background:var(--hp-accent); color:var(--text-primary-color,#fff); display:flex; align-items:center; justify-content:center; box-shadow:0 3px 10px color-mix(in srgb, var(--hp-accent) 40%, transparent); }
.bottomnav .navbtn.center ha-icon { --mdc-icon-size:26px; }
.bottomnav .navbtn.center .navlabel { font-variant-numeric:tabular-nums; }
.navlabel { white-space:nowrap; }

/* ---------- common ---------- */
.card { display:block; width:100%; text-align:left; background:var(--hp-card); border-radius:var(--hp-radius); padding:14px; margin-bottom:12px; box-shadow:var(--ha-card-box-shadow, none); border:var(--ha-card-border-width,1px) solid var(--ha-card-border-color, var(--hp-line)); }
.card.empty { text-align:center; padding:28px 16px; } .card.empty p { color:var(--hp-muted); }
.card.warn { border-color:#ff9500; color:#c46a00; }
.empty { text-align:center; color:var(--hp-muted); padding:24px; }
.bigicon { --mdc-icon-size:44px; color:var(--hp-accent); margin-bottom:6px; }
.row { display:flex; align-items:center; gap:8px; } .between { justify-content:space-between; }
.muted { color:var(--hp-muted); } .small { font-size:.85rem; } .xsmall { font-size:.72rem; } .center { text-align:center; } .right { text-align:right; }
.big { font-size:1.45rem; font-weight:650; line-height:1.15; font-variant-numeric:tabular-nums; } .big small { font-size:.85rem; font-weight:400; color:var(--hp-muted); }
.accent { color:var(--hp-accent); }
.section { margin:20px 4px 8px; } .row.section h3 { margin:0; }
.btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:9px 16px; border-radius:12px; background:var(--hp-fill); font-weight:600; min-height:42px; }
.btn.primary { background:var(--hp-accent); color:var(--text-primary-color,#fff); }
.btn.soft { background:var(--hp-fill); color:var(--hp-text); }
.btn.danger { color:var(--hp-bad); }
.btn.ghost { background:transparent; color:var(--hp-accent); } .btn.ghost.danger { color:var(--hp-bad); }
.btn.full { width:100%; margin-top:8px; } .btn.big { min-height:50px; font-size:1.02rem; } .btn.sm { padding:4px 12px; min-height:32px; font-size:.85rem; border-radius:16px; }
.iconbtn { width:40px; height:40px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; }
.iconbtn:active, .iconbtn:hover { background:var(--hp-fill); }
.iconbtn.sm { width:32px; height:32px; }
.iconbtn[disabled] { opacity:.3; }
.linklike { text-align:left; }
.seg { display:flex; background:var(--hp-fill); border-radius:10px; padding:2px; margin-bottom:14px; }
.seg button { flex:1; padding:7px; border-radius:8px; color:var(--hp-text); font-weight:500; font-size:.9rem; }
.seg button.on { background:var(--hp-card); box-shadow:0 1px 3px rgba(0,0,0,.12); font-weight:600; }
.badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:10px; font-size:.72rem; font-weight:600; }
.badge ha-icon { --mdc-icon-size:14px; } .badge.health { background:#ffe5ea; color:#d3173f; } .gold { background:#fff3cd; color:#8a6d00; } .blue { background:color-mix(in srgb, var(--hp-accent) 15%, transparent); color:var(--hp-accent); }

/* history */
.month { margin:18px 4px 8px; color:var(--hp-muted); font-weight:600; font-size:.78rem; text-transform:uppercase; letter-spacing:.05em; }
.stats { display:flex; gap:14px; margin:8px 0; font-size:.85rem; color:var(--hp-muted); flex-wrap:wrap; } .stats ha-icon { --mdc-icon-size:16px; }
.stats.big { font-size:1rem; color:var(--hp-text); margin:12px 0; font-weight:500; }
.exline { display:flex; justify-content:space-between; font-size:.9rem; padding:2px 0; gap:8px; }
.recgrid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:10px; } .recval { font-weight:600; }
.prs { background:#fff8e1; color:#6d5300; border-radius:10px; padding:8px 12px; margin:8px 0; } .pr { padding:3px 0; } .pr ha-icon { --mdc-icon-size:16px; color:#f9a825; }
.detailex { margin:14px 0; }
.settable { width:100%; border-collapse:collapse; margin-top:6px; } .settable td { padding:6px 4px; border-top:1px solid var(--hp-line); }
.setbadge { display:inline-flex; min-width:28px; height:28px; padding:0 4px; border-radius:8px; align-items:center; justify-content:center; font-weight:700; font-size:.9rem; background:var(--hp-fill); font-variant-numeric:tabular-nums; }
.setbadge.warm { background:color-mix(in srgb, var(--warm) 22%, transparent); color:#a77a00; }
.setbadge.drop { background:color-mix(in srgb, var(--drop) 20%, transparent); color:var(--drop); }
.setbadge.fail { background:color-mix(in srgb, var(--fail) 18%, transparent); color:var(--fail); }
.warntitle { color:#d97706; } .warntitle ha-icon { --mdc-icon-size:22px; }
.kcalbox { display:grid; grid-template-columns:auto auto 1fr; gap:4px 18px; align-items:center; background:var(--hp-fill); border-radius:12px; padding:10px 14px; margin:4px 0 10px; }
.kcalbox .big { color:#ff6b00; } .kcalsplit { line-height:1.4; }
.actions { display:flex; gap:8px; justify-content:flex-end; margin-top:16px; flex-wrap:wrap; }
.histrow { padding:8px 0; border-top:1px solid var(--hp-line); }
.hero { text-align:center; padding:24px 16px; }
.tpl .btn { margin-top:10px; }
.demo { display:block; width:100%; max-height:320px; object-fit:contain; border-radius:12px; background:#fff; margin:12px 0; }
.steps { padding-left:20px; margin:0; } .steps li { margin:4px 0; }

/* ---------- active workout ---------- */
.activehead { position:sticky; top:calc(-10px - env(safe-area-inset-top)); z-index:3; background:var(--hp-bg); padding:4px 4px 10px; margin:0 -4px 4px; }
.wide .activehead { top:-16px; }
.wname { font-size:1.6rem; font-weight:700; background:transparent; border:0; padding:2px 0; letter-spacing:-.01em; }
.wname:focus { background:var(--hp-fill); padding:2px 8px; }
.timer { font-variant-numeric:tabular-nums; font-size:1.05rem; color:var(--hp-accent); font-weight:600; }
.exercise { padding:12px 10px 8px; }
.exercise.ss { border-left:4px solid var(--ssc); } .ss0 { --ssc:#ff9500; } .ss1 { --ssc:#34c759; } .ss2 { --ssc:#af52de; } .ss3 { --ssc:#ff2d55; }
.exhead { display:flex; align-items:center; justify-content:space-between; gap:6px; padding-left:4px; }
.extitle { font-size:1.05rem; font-weight:650; color:var(--hp-accent); text-align:left; }
.exmeta { display:flex; gap:10px; align-items:center; font-size:.78rem; color:var(--hp-muted); padding:0 4px 8px; } .exmeta ha-icon { --mdc-icon-size:14px; }
.sstag { background:color-mix(in srgb, var(--ssc) 18%, transparent); color:var(--ssc); font-weight:700; padding:1px 7px; border-radius:6px; }
.sethead, .setrow { display:grid; grid-template-columns: 36px minmax(0,1fr) 68px 56px 44px; gap:8px; align-items:center; }
.sethead.k-duration, .setrow.k-duration { grid-template-columns: 36px minmax(0,1fr) 132px 44px; }
.sethead { font-size:.72rem; font-weight:600; color:var(--hp-muted); text-transform:uppercase; letter-spacing:.03em; padding:0 4px 4px; text-align:center; }
.sethead span:nth-child(2) { text-align:left; } .sethead ha-icon { --mdc-icon-size:16px; }
.setrow { padding:4px; border-radius:10px; margin-bottom:2px; transition:background .2s; }
.setrow.done { background:color-mix(in srgb, var(--hp-good) 18%, transparent); }
.setbtn { display:flex; justify-content:center; }
.setrow .prev { font-size:.85rem; color:var(--hp-muted); text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-variant-numeric:tabular-nums; min-height:36px; }
.cell { padding:7px 4px; text-align:center; border-radius:8px; min-width:0; font-weight:600; font-variant-numeric:tabular-nums; }
.setrow.done .cell { background:transparent; }
.check { width:44px; height:36px; border-radius:8px; background:var(--hp-fill); display:flex; align-items:center; justify-content:center; color:var(--hp-muted); position:relative; }
.check.on { background:var(--hp-good); color:#fff; }
.check .rpe { position:absolute; top:-6px; right:-6px; background:var(--hp-card); color:var(--hp-text); border:1px solid var(--hp-line); border-radius:8px; font-size:.65rem; font-weight:700; padding:0 4px; line-height:14px; }
.wnotes { margin-top:12px; min-height:70px; }
.restbar { display:flex; align-items:center; gap:10px; padding:8px 12px; background:var(--hp-card); border-top:.5px solid var(--hp-line); }
.restleft { flex:1 1 auto; min-width:0; text-align:left; }
.resttime { display:flex; align-items:center; gap:6px; color:var(--hp-accent); }
.resttime b { font-size:1.25rem; font-weight:700; font-variant-numeric:tabular-nums; min-width:3.2em; }
.restnext { font-size:.75rem; color:var(--hp-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.restbtns { flex:0 0 auto; display:flex; gap:6px; margin-left:auto; }

/* ---------- nutrition ---------- */
.wide .widewrap .cols { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(300px,1fr); gap:20px; align-items:start; }
.wide .widewrap .colside { position:sticky; top:0; }
.datenav { display:flex; align-items:center; justify-content:center; gap:16px; margin-bottom:8px; }
.summary { display:flex; gap:16px; align-items:center; }
.ringwrap { position:relative; width:124px; height:124px; flex:0 0 auto; }
.ring { width:100%; height:100%; } .ringbg { fill:none; stroke:var(--hp-fill); stroke-width:11; }
.ringfg { fill:none; stroke:var(--hp-accent); stroke-width:11; stroke-linecap:round; transition:stroke-dashoffset .4s; } .ringfg.over { stroke:var(--hp-bad); }
.ringtext { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.sumright { flex:1; display:flex; flex-direction:column; gap:5px; min-width:0; }
.bar { height:7px; background:var(--hp-fill); border-radius:4px; overflow:hidden; margin:3px 0; }
.fill { height:100%; border-radius:4px; background:var(--hp-accent); transition:width .4s; }
.fill.p { background:#ff3b30; } .fill.c { background:#ff9500; } .fill.f { background:#af52de; }
.meal h3 { margin:0; }
.foodrow { display:flex; width:100%; justify-content:space-between; align-items:center; gap:10px; text-align:left; padding:10px 2px; border-top:1px solid var(--hp-line); }
.foodrow > div { min-width:0; } .foodrow .kcal { font-weight:600; white-space:nowrap; font-variant-numeric:tabular-nums; }
.avg { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
.avg th, .avg td { padding:7px 4px; text-align:right; border-top:1px solid var(--hp-line); }
.avg thead th { border-top:0; font-size:.75rem; color:var(--hp-muted); font-weight:600; }
.avg tbody th { text-align:left; font-weight:500; }
.avg td { font-weight:600; }
.bars { padding-bottom:18px; }
.plot { position:relative; display:flex; align-items:flex-end; gap:4px; height:130px; }
.bcol { flex:1; height:100%; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; position:relative; }
.bcol span { position:absolute; bottom:-18px; font-size:.65rem; color:var(--hp-muted); }
.bbar { width:100%; max-width:22px; background:color-mix(in srgb, var(--hp-accent) 50%, transparent); border-radius:4px 4px 2px 2px; min-height:2px; }
.bbar.today { background:var(--hp-accent); } .bbar.over { background:#ff9500; }
.tline { position:absolute; left:0; right:0; border-top:1.5px dashed var(--hp-muted); opacity:.7; z-index:1; pointer-events:none; }
.tline span { position:absolute; right:0; top:-15px; font-size:.65rem; color:var(--hp-muted); }
.minitiles { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.filepick { display:flex; align-items:center; justify-content:center; gap:8px; padding:18px; border:2px dashed var(--hp-line); border-radius:14px; color:var(--hp-accent); font-weight:600; cursor:pointer; margin:10px 0; }
.importsum { border-color:var(--hp-accent); }
.maplist { margin-top:6px; } .maprow { display:grid; grid-template-columns:1fr 18px 1fr 34px; gap:6px; align-items:center; padding:6px 0; border-top:1px solid var(--hp-line); font-size:.85rem; }
.maprow ha-icon { --mdc-icon-size:14px; } .maprow > span:last-child { text-align:right; }
.attribution { text-align:center; font-size:.72rem; color:var(--hp-muted); margin:16px 0 4px; }
.attribution a { color:inherit; text-decoration:underline; }
.searchbox { display:flex; align-items:center; gap:6px; background:var(--hp-fill); border-radius:10px; padding:0 10px; margin-bottom:8px; }
.searchbox input { border:0; background:transparent; padding:10px 4px; } .searchbox input:focus { background:transparent; border:0; }
.portion { display:flex; gap:8px; margin:14px 0; } .portion .amount { width:110px; flex:0 0 auto; font-size:1.2rem; text-align:center; font-weight:600; }
.nutri { display:grid; grid-template-columns:repeat(4,1fr); text-align:center; background:var(--hp-fill); border-radius:12px; padding:12px 4px; margin-bottom:12px; }
.nutri .big { font-size:1.2rem; }
.form { display:flex; flex-direction:column; gap:10px; margin:10px 0; }
.form label, label.inline { display:flex; flex-direction:column; gap:4px; font-size:.82rem; color:var(--hp-muted); font-weight:500; }
label.inline { flex-direction:row; align-items:center; gap:8px; } label.inline select, label.inline input { width:auto; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; } .grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }

/* ---------- profile ---------- */
.weights { display:flex; align-items:center; justify-content:space-around; margin:14px 0 8px; text-align:center; }
.chart { width:100%; height:110px; margin:10px 0 4px; } .chart .line { fill:none; stroke:var(--hp-accent); stroke-width:2.5; vector-effect:non-scaling-stroke; }
.chart .area { fill:color-mix(in srgb, var(--hp-accent) 14%, transparent); } .chart .dot { fill:var(--hp-accent); } .chart .lbl { font-size:10px; fill:var(--hp-muted); }
.tiles { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px,1fr)); gap:10px; }
.narrow .tiles { grid-template-columns:1fr 1fr; }
.tile { background:var(--hp-card); border-radius:var(--hp-radius); padding:12px; text-align:left; border:1px solid var(--hp-line); display:flex; flex-direction:column; gap:2px; }
.tile ha-icon { color:var(--hp-accent); margin-bottom:4px; } .tileval { font-size:1.12rem; font-weight:650; }
.egrid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:4px 0 10px; }
.card.list { padding:0 14px; }
.listrow { display:grid; grid-template-columns:24px 1fr auto 20px; align-items:center; gap:10px; width:100%; padding:13px 0; text-align:left; }
.listrow + .listrow { border-top:1px solid var(--hp-line); } .listrow > ha-icon:first-child { color:var(--hp-accent); }

/* template / picker */
.tplex { border-top:1px solid var(--hp-line); padding:10px 0; } .tplrow { flex-wrap:wrap; margin-top:6px; } .tplrow .cell { width:56px; }
.chips { display:flex; gap:6px; overflow-x:auto; padding-bottom:6px; margin-bottom:4px; scrollbar-width:none; } .chips::-webkit-scrollbar { display:none; }
.chip { padding:6px 12px; border-radius:16px; background:var(--hp-fill); white-space:nowrap; font-size:.85rem; font-weight:500; }
.chip.on { background:var(--hp-accent); color:var(--text-primary-color,#fff); }
.newex { margin-top:12px; } .newex summary { color:var(--hp-accent); cursor:pointer; padding:8px 0; font-weight:600; }

/* ---------- sheets (fixed to the screen, slide up like iOS) ---------- */
.scrim { position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:50; animation:fade .2s; }
.sheet { position:fixed; left:0; right:0; bottom:0; max-height:calc(100dvh - 44px - env(safe-area-inset-top)); z-index:51; background:var(--hp-card); border-radius:16px 16px 0 0; display:flex; flex-direction:column; box-shadow:0 -4px 30px rgba(0,0,0,.18); }
.sheet.anim { animation:up .3s cubic-bezier(.2,.9,.3,1); }
/* Phones: sheets live inside the pinned app, so they sit right on top of the keyboard. */
.narrow .scrim { position:absolute; inset:0; }
.narrow .sheet { position:absolute; bottom:0; max-height:calc(100% - 44px - env(safe-area-inset-top)); }
.wide .sheet { left:50%; right:auto; bottom:auto; top:50%; transform:translate(-50%,-50%); width:min(560px, 92vw); max-height:86vh; border-radius:16px; }
.wide .sheet.anim { animation:pop .18s ease-out; }
.grabzone { padding:8px 0 4px; flex:0 0 auto; touch-action:none; } .grab { width:38px; height:5px; border-radius:3px; background:var(--hp-line); margin:0 auto; } .wide .grabzone { display:none; }
.sheet .close { position:absolute; top:10px; right:10px; background:var(--hp-fill); width:30px; height:30px; } .sheet .close ha-icon { --mdc-icon-size:18px; }
.narrow.kb .sheetbody { padding-bottom:16px; }
.sheetbody { overflow-y:auto; padding:6px 16px calc(20px + env(safe-area-inset-bottom)); -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
.wide .sheetbody { padding:20px; }
.sheetbody > h2:first-child { padding-right:40px; }
.menu { display:flex; flex-direction:column; margin-top:10px; background:var(--hp-fill); border-radius:12px; overflow:hidden; }
.menuitem { display:flex; align-items:center; gap:12px; padding:13px 14px; text-align:left; font-weight:500; }
.menuitem + .menuitem { border-top:1px solid var(--hp-line); }
.menuitem:active { background:var(--hp-fill); }
.menuitem > ha-icon:first-child { color:var(--hp-accent); } .menuitem.danger, .menuitem.danger ha-icon { color:var(--hp-bad) !important; }
.mlabel { flex:1; display:flex; flex-direction:column; }
.rpebig { width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; font-weight:700; color:#fff; flex:0 0 auto; }
.e6 { background:#34c759; } .e7 { background:#a2c037; } .e8 { background:#ffcc00; color:#5a4800; } .e9 { background:#ff9500; } .e10 { background:#ff3b30; }
@keyframes up { from { transform:translateY(100%); } } @keyframes fade { from { opacity:0; } }
@keyframes pop { from { opacity:0; transform:translate(-50%,-48%) scale(.97); } }
.toast { position:fixed; left:50%; transform:translateX(-50%); top:calc(12px + env(safe-area-inset-top)); z-index:60; background:rgba(30,30,30,.92); color:#fff; padding:10px 18px; border-radius:22px; font-size:.9rem; box-shadow:0 4px 16px rgba(0,0,0,.25); max-width:90%; text-align:center; animation:fade .2s; }
.wide .toast { top:auto; bottom:24px; } .toast.err { background:var(--hp-bad); }
@media (max-width: 370px) { .sethead, .setrow { grid-template-columns: 30px minmax(0,1fr) 60px 50px 40px; gap:6px; } .ringwrap { width:104px; height:104px; } }
`;

// Home Assistant can load a fresh copy of this file (new ?v= after an update) while the old
// one is still registered; the first definition wins until the page reloads.
if (!customElements.get("health-assistant-panel")) customElements.define("health-assistant-panel", HealthAssistantPanel);
