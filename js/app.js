/* ===========================================================================
 *  App — boots data, wires the router, keeps scores fresh.
 * ======================================================================== */

const App = {
  routes: {
    leaderboard: () => UI.leaderboard(),
    owners: () => UI.owners(),
    owner: (p) => UI.owner(p[0]),
    fixtures: (p, q) => UI.fixtures(q),
    clashes: () => UI.clashes(),
    groups: () => UI.groups(),
    stats: () => UI.stats(),
  },

  nav: [
    ["leaderboard", "🏆 Table"],
    ["owners", "👥 Managers"],
    ["fixtures", "📅 Fixtures"],
    ["clashes", "⚔️ Clashes"],
    ["groups", "🗂️ Groups"],
    ["stats", "📊 Stats"],
  ],

  async start() {
    this.renderShell();
    try {
      await Data.load();
    } catch (e) {
      document.getElementById("app").innerHTML =
        `<div class="fatal">Couldn't load the data files.<br><small>${UI.esc(e.message)}</small></div>`;
      return;
    }
    window.addEventListener("hashchange", () => this.route());
    this.route();
    this.startClock();
    this.startRefresh();
  },

  renderShell() {
    document.getElementById("root").innerHTML = `
      <header class="topbar">
        <div class="brand">
          <span class="logo">⚽</span>
          <div>
            <div class="brand-title">${UI.esc(CONFIG.title)}</div>
            <div class="brand-sub">${UI.esc(CONFIG.subtitle)}</div>
          </div>
        </div>
        <div class="topbar-right">
          <span class="freshness" id="freshness"></span>
          <button class="refresh" id="refreshBtn" title="Refresh scores">⟳</button>
        </div>
      </header>
      <nav class="tabs" id="tabs">
        ${this.nav
          .map(([k, lbl]) => `<a class="tab" data-route="${k}" href="#/${k}">${lbl}</a>`)
          .join("")}
      </nav>
      <main id="app" class="app"><div class="loading">Loading the sweepstakes…</div></main>
      <footer class="foot">
        Data: <a href="https://github.com/rezarahiminia/worldcup2026" target="_blank" rel="noopener">worldcup2026 API</a>
        · auto-refreshing every ${CONFIG.refreshSeconds}s · built for the lads 🍺
      </footer>`;
    document.getElementById("refreshBtn").addEventListener("click", () => this.refresh(true));
  },

  parseHash() {
    const raw = (location.hash || "#/leaderboard").replace(/^#\/?/, "");
    const [path, query] = raw.split("?");
    const parts = path.split("/").filter(Boolean);
    const name = parts[0] || "leaderboard";
    const params = parts.slice(1);
    const q = {};
    (query || "").split("&").forEach((kv) => {
      if (!kv) return;
      const [k, v] = kv.split("=");
      q[k] = decodeURIComponent(v || "");
    });
    return { name, params, q };
  },

  route() {
    const { name, params, q } = this.parseHash();
    const fn = this.routes[name] || this.routes.leaderboard;
    const app = document.getElementById("app");
    app.innerHTML = fn(params, q);
    app.scrollTop = 0;
    window.scrollTo(0, 0);
    // active tab (owner detail keeps Managers highlighted)
    const active = name === "owner" ? "owners" : name;
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("on", t.dataset.route === active)
    );
    this.tickClock();
  },

  /* -- live refresh ------------------------------------------------------- */
  startRefresh() {
    setInterval(() => this.refresh(false), CONFIG.refreshSeconds * 1000);
  },
  async refresh(manual) {
    const btn = document.getElementById("refreshBtn");
    if (btn) btn.classList.add("spin");
    await Data._overlayRemote();
    this.route();
    this.setFreshness(manual ? "updated just now" : "");
    if (btn) setTimeout(() => btn.classList.remove("spin"), 600);
  },
  setFreshness(msg) {
    const el = document.getElementById("freshness");
    if (!el) return;
    const live = Engine.liveMatches().length;
    el.textContent = live
      ? `🔴 ${live} live`
      : msg || (Data.meta.live ? "live data" : "");
  },

  /* -- 1s ticker for the "next kick-off" countdown ------------------------ */
  startClock() {
    setInterval(() => this.tickClock(), 1000);
    this.tickClock();
  },
  tickClock() {
    this.setFreshness("");
    const el = document.getElementById("nextup");
    if (!el) return;
    const target = Engine.matchDate({ date: el.dataset.date });
    const span = el.querySelector(".cd");
    if (!target || !span) return;
    let diff = target - new Date();
    if (diff <= 0) {
      span.textContent = "kick-off!";
      return;
    }
    const d = Math.floor(diff / 86400000); diff -= d * 86400000;
    const h = Math.floor(diff / 3600000); diff -= h * 3600000;
    const m = Math.floor(diff / 60000); diff -= m * 60000;
    const sec = Math.floor(diff / 1000);
    span.textContent =
      (d ? d + "d " : "") + String(h).padStart(2, "0") + ":" +
      String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  },
};

document.addEventListener("DOMContentLoaded", () => App.start());
