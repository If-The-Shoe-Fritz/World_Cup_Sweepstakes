/* ===========================================================================
 *  UI — rendering + hash routing. Every view is a pure function of the engine.
 * ======================================================================== */

const UI = {
  /* -- tiny helpers ------------------------------------------------------- */
  esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  },
  color(ownerId) {
    return CONFIG.ownerColors[ownerId] || "#888";
  },
  ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  },
  initials(name) {
    return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  },
  plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  },

  /* All kick-off times shown in CONFIG.displayTZ (AEST) */
  fmtTime(d) {
    return d.toLocaleTimeString("en-AU", { timeZone: CONFIG.displayTZ, hour: "2-digit", minute: "2-digit" });
  },
  fmtDayShort(d) {
    return d.toLocaleDateString("en-AU", { timeZone: CONFIG.displayTZ, weekday: "short", day: "numeric", month: "short" });
  },
  fmtDayLong(d) {
    return d.toLocaleDateString("en-AU", { timeZone: CONFIG.displayTZ, weekday: "long", day: "numeric", month: "long" });
  },
  fmtDateShort(d) {
    return d.toLocaleDateString("en-AU", { timeZone: CONFIG.displayTZ, day: "numeric", month: "short" });
  },
  dayKey(d) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: CONFIG.displayTZ }).format(d);
  },

  // plain-English list of where an owner's points come from, e.g.
  // [{icon,label:"2 wins",calc:"2 × 3",pts:6}, {icon,label:"5 goals",...}]
  pointParts(r) {
    const S = CONFIG.scoring;
    const a = r.agg;
    const parts = [];
    if (a.w) parts.push({ icon: "✅", label: this.plural(a.w, "win"), calc: `${a.w} × ${S.result.win}`, pts: a.w * S.result.win });
    if (a.d) parts.push({ icon: "🤝", label: this.plural(a.d, "draw"), calc: `${a.d} × ${S.result.draw}`, pts: a.d * S.result.draw });
    if (S.result.loss && a.l) parts.push({ icon: "❌", label: this.plural(a.l, "loss").replace("losss", "losses"), calc: `${a.l} × ${S.result.loss}`, pts: a.l * S.result.loss });
    if (a.gf) parts.push({ icon: "⚽", label: this.plural(a.gf, "goal"), calc: `${a.gf} × ${S.goalFor}`, pts: a.gf * S.goalFor });
    if (S.goalAgainst && a.ga) parts.push({ icon: "🥅", label: `${a.ga} conceded`, calc: `${a.ga} × ${S.goalAgainst}`, pts: a.ga * S.goalAgainst });
    if (r.breakdown.advancePts) parts.push({ icon: "🏆", label: "deep-run bonus", calc: "", pts: r.breakdown.advancePts });
    if (r.breakdown.csPts) parts.push({ icon: "🧤", label: this.plural(a.cs, "clean sheet"), calc: `${a.cs} × ${S.cleanSheet}`, pts: r.breakdown.csPts });
    return parts;
  },

  // one-team version, e.g. "1 win (3) + 2 goals (2) = 5"
  contribPlain(c) {
    const S = CONFIG.scoring;
    const p = [];
    if (c.rec.w) p.push(`${this.plural(c.rec.w, "win")} (${c.rec.w * S.result.win})`);
    if (c.rec.d) p.push(`${this.plural(c.rec.d, "draw")} (${c.rec.d * S.result.draw})`);
    if (c.rec.gf) p.push(`${this.plural(c.rec.gf, "goal")} (${c.rec.gf * S.goalFor})`);
    if (c.banked) p.push(`deep run (+${c.banked})`);
    if (!p.length) return c.rec.mp ? "0 pts so far" : "not played yet";
    return p.join(" + ") + ` = ${c.total}`;
  },

  ownerChip(owner, opts = {}) {
    if (!owner) return `<span class="chip chip-tbd">TBD</span>`;
    const c = this.color(owner.id);
    return `<a class="chip" href="#/owner/${owner.id}" style="--c:${c}">
      <span class="chip-dot"></span>${this.esc(owner.name)}${opts.suffix || ""}</a>`;
  },

  teamLine(team, opts = {}) {
    if (!team) return `<span class="team team-tbd">${flagImg(null)}<span class="tname">TBD</span></span>`;
    const owner = Data.ownerForTeam(team.id);
    const oc = owner ? this.color(owner.id) : "transparent";
    return `<span class="team" style="--oc:${oc}">
      ${flagImg(team)}
      <span class="tname">${this.esc(team.name)}</span>
      ${opts.code ? `<span class="tcode">${this.esc(team.code)}</span>` : ""}
      ${owner && opts.owner ? `<span class="towner" style="--c:${this.color(owner.id)}">${this.esc(owner.name)}</span>` : ""}
    </span>`;
  },

  formBadges(form) {
    if (!form || !form.length) return `<span class="form-empty">—</span>`;
    return `<span class="form">${form
      .slice(-5)
      .map((r) => `<span class="fb fb-${r}">${r}</span>`)
      .join("")}</span>`;
  },

  statusTag(m) {
    if (Engine.isLive(m))
      return `<span class="tag tag-live"><span class="dot"></span>LIVE ${UI.esc(m.status)}</span>`;
    if (m.finished) return `<span class="tag tag-ft">FT</span>`;
    const d = Engine.matchDate(m);
    const day = d ? this.fmtDayShort(d) : "";
    const time = d ? this.fmtTime(d) : "";
    return `<span class="tag tag-up">${day} · ${time} ${CONFIG.tzLabel}</span>`;
  },

  stageLabel(type) {
    const s = CONFIG.stages.find((x) => x.key === type);
    return s ? s.short : type;
  },

  /* -- a full match card (used in several places) ------------------------- */
  matchCard(m, opts = {}) {
    const home = Engine.hasTeams(m) ? Data.team(m.home_id) : null;
    const away = Engine.hasTeams(m) ? Data.team(m.away_id) : null;
    const ho = home ? Data.ownerForTeam(home.id) : null;
    const ao = away ? Data.ownerForTeam(away.id) : null;
    const played = Engine.isPlayed(m);
    const live = Engine.isLive(m);
    const stad = Data.stadium(m.stadium_id);
    const hWin = played && m.home_score > m.away_score;
    const aWin = played && m.away_score > m.home_score;
    const score = played || live
      ? `<span class="mscore ${live ? "live" : ""}"><b class="${hWin ? "sc-win" : ""}">${m.home_score ?? 0}</b><span>–</span><b class="${aWin ? "sc-win" : ""}">${m.away_score ?? 0}</b></span>`
      : `<span class="mvs">vs</span>`;
    const groupTag = m.type === "group"
      ? `Group ${this.esc(m.group)} · MD${this.esc(m.matchday)}`
      : this.stageLabel(m.type);
    const win = (side) =>
      played && ((side === "h" && m.home_score > m.away_score) ||
                 (side === "a" && m.away_score > m.home_score))
        ? "win" : "";
    return `<div class="match ${live ? "is-live" : ""} ${played ? "is-ft" : ""}">
      <div class="match-top">
        <span class="mtag">${groupTag}</span>
        ${this.statusTag(m)}
      </div>
      <div class="match-body">
        <div class="mteam home ${win("h")}">
          <div class="mteam-main">${this.teamLine(home, { code: true })}</div>
          ${opts.owners !== false ? this.ownerChip(ho) : ""}
        </div>
        ${score}
        <div class="mteam away ${win("a")}">
          <div class="mteam-main">${this.teamLine(away, { code: true })}</div>
          ${opts.owners !== false ? this.ownerChip(ao) : ""}
        </div>
      </div>
      ${stad ? `<div class="match-foot">🏟️ ${this.esc(stad.fifa_name || stad.name)} · ${this.esc(stad.city)}</div>` : ""}
    </div>`;
  },

  /* ======================================================================
   *  VIEW: Leaderboard (home)
   * =================================================================== */
  leaderboard() {
    const rows = Engine.leaderboard();
    const podium = rows.slice(0, 3);
    const podOrder = [podium[1], podium[0], podium[2]].filter(Boolean); // 2-1-3

    const podiumHtml = `<div class="podium">${podOrder
      .map((r) => {
        const place = r.rank;
        const teams = r.owner.team_ids
          .map((id) => flagImg(Data.team(id), "pflag"))
          .join("");
        return `<a href="#/owner/${r.owner.id}" class="pod pod-${place}" style="--c:${this.color(r.owner.id)}">
          <div class="pod-medal">${place === 1 ? "🥇" : place === 2 ? "🥈" : "🥉"}</div>
          <div class="pod-name">${this.esc(r.owner.name)}</div>
          <div class="pod-pts">${r.total}<small>pts</small></div>
          <div class="pod-flags">${teams}</div>
        </a>`;
      })
      .join("")}</div>`;

    const tableHtml = `<div class="card table-card">
      <table class="lb">
        <thead><tr>
          <th class="c-rank">#</th><th class="c-owner">Manager</th>
          <th>P</th><th>W</th><th>D</th><th>L</th>
          <th>GF</th><th>GA</th><th class="c-prog">Bonus</th>
          <th class="c-total">Pts</th>
        </tr></thead>
        <tbody>${rows
          .map((r) => {
            const teams = r.owner.team_ids
              .map((id) => flagImg(Data.team(id), "lbflag"))
              .join("");
            return `<tr class="lb-row" onclick="location.hash='#/owner/${r.owner.id}'" style="--c:${this.color(r.owner.id)}">
              <td class="c-rank"><span class="rankpill">${r.rank}</span></td>
              <td class="c-owner">
                <span class="lb-dot"></span>
                <span class="lb-name">${this.esc(r.owner.name)}${r.champion ? " 👑" : ""}</span>
                <span class="lb-flags">${teams}</span>
              </td>
              <td>${r.agg.mp}</td><td>${r.agg.w}</td><td>${r.agg.d}</td><td>${r.agg.l}</td>
              <td class="pos">${r.agg.gf}</td><td>${r.agg.ga}</td>
              <td class="c-prog">${r.breakdown.advancePts ? "+" + r.breakdown.advancePts : "—"}</td>
              <td class="c-total"><b>${r.total}</b></td>
            </tr>`;
          })
          .join("")}</tbody>
      </table>
    </div>`;

    const scoringNote = `<div class="hint">
      <b>How points work:</b> ${CONFIG.scoring.result.win} for a win,
      ${CONFIG.scoring.result.draw} for a draw, and
      <b>+${CONFIG.scoring.goalFor} for every goal</b> your teams score —
      plus bonus points the further a team goes (R32 +${CONFIG.scoring.advance.r32}
      up to Champion +${CONFIG.scoring.champion}).
      So 2 wins + 5 goals = ${2 * CONFIG.scoring.result.win + 5 * CONFIG.scoring.goalFor} points.
      Tap any manager to see their exact sum.
    </div>`;

    return `<section class="view">
      <div class="view-head"><h1>Leaderboard</h1></div>
      ${this.nextMatchBanner()}
      ${podiumHtml}
      ${scoringNote}
      ${tableHtml}
    </section>`;
  },

  // prominent "what's on next" banner — shows both teams AND their managers
  nextMatchBanner() {
    const live = Engine.liveMatches();
    const m = live[0] || Engine.upcoming(1)[0];
    if (!m) return "";
    const isLive = live.length > 0;
    const home = Engine.hasTeams(m) ? Data.team(m.home_id) : null;
    const away = Engine.hasTeams(m) ? Data.team(m.away_id) : null;
    const ho = home ? Data.ownerForTeam(home.id) : null;
    const ao = away ? Data.ownerForTeam(away.id) : null;
    const stad = Data.stadium(m.stadium_id);
    const d = Engine.matchDate(m);
    const when = d ? `${this.fmtDayShort(d)} · ${this.fmtTime(d)} ${CONFIG.tzLabel}` : "";
    const tag = m.type === "group"
      ? `Group ${this.esc(m.group)} · Matchday ${this.esc(m.matchday)}`
      : this.stageLabel(m.type);
    const foot = [tag, stad ? `${this.esc(stad.fifa_name || stad.name)}, ${this.esc(stad.city)}` : "", when]
      .filter(Boolean)
      .join(" · ");
    const right = isLive
      ? `<span class="tag tag-live"><span class="dot"></span>LIVE</span>`
      : `<span class="nx-cd">kicks off in <span class="cd">—</span></span>`;
    const mid = isLive
      ? `<span class="nx-score">${m.home_score ?? 0}–${m.away_score ?? 0}</span>`
      : `<span class="nx-vs">vs</span>`;
    return `<div class="nextcard ${isLive ? "is-live" : ""}" ${isLive || !d ? "" : `id="nextup" data-date="${d.toISOString()}"`}>
      <div class="nx-top"><span class="nx-label">${isLive ? "⚽ On now" : "⚽ Next kick-off"}</span>${right}</div>
      <div class="nx-body">
        <div class="nx-side">
          ${flagImg(home, "nxflag")}
          <div class="nx-meta"><span class="nx-team">${this.esc(home ? home.name : "TBD")}</span>${this.ownerChip(ho)}</div>
        </div>
        ${mid}
        <div class="nx-side right">
          ${flagImg(away, "nxflag")}
          <div class="nx-meta"><span class="nx-team">${this.esc(away ? away.name : "TBD")}</span>${this.ownerChip(ao)}</div>
        </div>
      </div>
      <div class="nx-foot">${foot}</div>
    </div>`;
  },

  /* ======================================================================
   *  VIEW: Owners grid
   * =================================================================== */
  owners() {
    const rows = Engine.leaderboard();
    const cards = rows
      .map((r) => {
        const teams = r.owner.team_ids
          .map((id) => {
            const t = Data.team(id);
            return `<div class="oc-team">${flagImg(t, "ocflag")}<span>${this.esc(t.name)}</span></div>`;
          })
          .join("");
        return `<a class="card owner-card" href="#/owner/${r.owner.id}" style="--c:${this.color(r.owner.id)}">
          <div class="oc-head">
            <span class="oc-rank">${this.ordinal(r.rank)}</span>
            <span class="oc-name">${this.esc(r.owner.name)}${r.champion ? " 👑" : ""}</span>
            <span class="oc-pts">${r.total}<small>pts</small></span>
          </div>
          <div class="oc-teams">${teams}</div>
          ${r.mvp
            ? `<div class="oc-mvp">⭐ Top: ${flagImg(r.mvp.team, "ocmvpflag")}<span>${this.esc(r.mvp.team.name)}</span><b>${r.mvp.total}</b></div>`
            : `<div class="oc-mvp oc-mvp-none">⭐ Top performer — TBD</div>`}
          <div class="oc-stat">
            <span>${r.agg.w}<small>W</small></span>
            <span>${r.agg.d}<small>D</small></span>
            <span>${r.agg.l}<small>L</small></span>
            <span class="pos">${r.agg.gf}<small>GF</small></span>
          </div>
        </a>`;
      })
      .join("");
    return `<section class="view">
      <div class="view-head"><h1>Managers</h1></div>
      <div class="owner-grid">${cards}</div>
    </section>`;
  },

  /* ======================================================================
   *  VIEW: Owner detail
   * =================================================================== */
  owner(id) {
    const rows = Engine.leaderboard();
    const r = rows.find((x) => x.owner.id === id);
    if (!r) return `<section class="view"><p>Unknown manager.</p></section>`;
    const c = this.color(id);

    // plain-English points breakdown
    const parts = this.pointParts(r);
    const plain = parts.length
      ? parts.map((p) => `${p.label} <span class="bd-sub">(${p.pts})</span>`).join(" &nbsp;+&nbsp; ") +
        ` &nbsp;=&nbsp; <b>${r.total} ${r.total === 1 ? "point" : "points"}</b>`
      : "No points yet — none of their teams have kicked off.";
    const receipt = parts
      .map(
        (p) => `<div class="bd-line">
        <span class="bd-ic">${p.icon}</span>
        <span class="bd-desc">${p.label.charAt(0).toUpperCase() + p.label.slice(1)}${p.calc ? ` <small>${p.calc} pts</small>` : ""}</span>
        <span class="bd-eq">${p.pts >= 0 ? "+" : ""}${p.pts}</span>
      </div>`
      )
      .join("");

    const medals = ["🥇", "🥈", "🥉"];

    // ranked "who's earning me points" strip
    const perfRows = r.contributions
      .map((c, i) => {
        const stageTxt = c.deepest !== "group"
          ? "reached " + this.stageLabel(c.deepest)
          : c.rec.mp
            ? `${c.rec.w}W ${c.rec.d}D ${c.rec.l}L`
            : "not played yet";
        return `<div class="perf-row ${i === 0 && c.total > 0 ? "perf-top" : ""}">
          <span class="perf-rank">${medals[i] || i + 1}</span>
          ${flagImg(c.team, "perfflag")}
          <span class="perf-name">${this.esc(c.team.name)}</span>
          <span class="perf-meta">${c.rec.gf} GF · ${stageTxt}</span>
          <span class="perf-pts">${c.total}<small>pts</small></span>
        </div>`;
      })
      .join("");
    const topPerformers = `<div class="card perf-card">
      <h3>Top performers${r.mvp ? ` · MVP <b class="mvp-name">${this.esc(r.mvp.team.name)}</b>` : ""}</h3>
      <div class="perf-list">${perfRows}</div>
    </div>`;

    // detailed cards, ordered best-first to match the ranking above
    const teamCards = r.contributions
      .map((c, i) => {
        const t = c.team;
        const tid = t.id;
        const rec = c.rec;
        const stage = r.teamStages[tid];
        const fixtures = Data.matches
          .filter((m) => m.home_id === tid || m.away_id === tid)
          .sort((a, b) => a.id - b.id);
        const fxHtml = fixtures.map((m) => this.miniFixture(m, tid)).join("");
        const stageBadge = stage.deepest !== "group"
          ? `<span class="reach">Reached ${this.stageLabel(stage.deepest)}${stage.banked ? ` · +${stage.banked}` : ""}</span>`
          : "";
        return `<div class="card team-card">
          <div class="tc-head">
            <span class="tc-medal">${medals[i] || ""}</span>
            ${flagImg(t, "tcflag")}
            <div class="tc-id">
              <div class="tc-name">${this.esc(t.name)} <span class="tc-grp">Grp ${this.esc(t.group)}</span></div>
              <div class="tc-rec">${rec.mp ? `${rec.mp} P · ${rec.w}-${rec.d}-${rec.l} · ${rec.gf}:${rec.ga}` : "no games yet"}</div>
            </div>
            <span class="tc-pts">${c.total}<small>pts</small></span>
          </div>
          <div class="tc-formrow">${this.formBadges(rec.form)}${stageBadge}</div>
          <div class="tc-earned">📊 ${this.contribPlain(c)}</div>
          <div class="tc-fixtures">${fxHtml}</div>
        </div>`;
      })
      .join("");

    // curated "players to watch" across the manager's three teams
    const watchBlocks = r.contributions
      .map((cc) => {
        const list = Data.playersFor(cc.team.id);
        if (!list.length) return "";
        return `<div class="watch-team">
          ${flagImg(cc.team, "watchflag")}
          <span class="watch-tname">${this.esc(cc.team.name)}</span>
          <span class="watch-players">${list.map((p) => `<span class="watch-p">${this.esc(p)}</span>`).join("")}</span>
        </div>`;
      })
      .filter(Boolean)
      .join("");
    const watchCard = watchBlocks
      ? `<div class="card watch-card"><h3>⭐ Players to watch</h3>${watchBlocks}</div>`
      : "";

    return `<section class="view owner-view" style="--c:${c}">
      <a class="back" href="#/owners">← all managers</a>
      <div class="owner-hero">
        <div class="oh-avatar">${this.initials(r.owner.name)}</div>
        <div class="oh-main">
          <div class="oh-rank">${this.ordinal(r.rank)} place${r.champion ? " · 👑 Champion owner" : ""}</div>
          <h1>${this.esc(r.owner.name)}</h1>
          <div class="oh-sub">${r.agg.w}W ${r.agg.d}D ${r.agg.l}L · ${r.agg.gf} scored · ${r.agg.ga} conceded</div>
        </div>
        <div class="oh-pts">${r.total}<small>pts</small></div>
      </div>

      <div class="card breakdown">
        <h3>How ${this.esc(r.owner.name)}'s points add up</h3>
        <p class="bd-plain">${plain}</p>
        <div class="bd-lines">${receipt}</div>
        <div class="bd-total">Total <b>${r.total}</b></div>
        <p class="bd-key">3 pts a win · 1 a draw · +1 every goal · plus bonuses the further a team goes (R32 +${CONFIG.scoring.advance.r32} … Champion +${CONFIG.scoring.champion})</p>
      </div>

      ${topPerformers}

      ${watchCard}

      <div class="team-cards">${teamCards}</div>
    </section>`;
  },

  miniFixture(m, tid) {
    const home = Engine.hasTeams(m) ? Data.team(m.home_id) : null;
    const away = Engine.hasTeams(m) ? Data.team(m.away_id) : null;
    const isHome = m.home_id === tid;
    const opp = isHome ? away : home;
    const oppOwner = opp ? Data.ownerForTeam(opp.id) : null;
    const played = Engine.isPlayed(m);
    let res = "", cls = "";
    if (played) {
      const mine = isHome ? m.home_score : m.away_score;
      const theirs = isHome ? m.away_score : m.home_score;
      res = `${mine}–${theirs}`;
      cls = mine > theirs ? "w" : mine < theirs ? "l" : "d";
    } else if (Engine.isLive(m)) {
      const mine = isHome ? m.home_score : m.away_score;
      const theirs = isHome ? m.away_score : m.home_score;
      res = `${mine ?? 0}–${theirs ?? 0}`;
      cls = "live";
    } else {
      const d = Engine.matchDate(m);
      res = d ? this.fmtDateShort(d) : "TBD";
      cls = "up";
    }
    return `<div class="mfx mfx-${cls}">
      <span class="mfx-stage">${this.stageLabel(m.type)}</span>
      <span class="mfx-opp">${opp ? flagImg(opp, "mfxflag") : ""}${this.esc(opp ? opp.name : "TBD")}</span>
      ${oppOwner ? `<span class="mfx-owner" style="--c:${this.color(oppOwner.id)}">${this.esc(oppOwner.name)}</span>` : ""}
      <span class="mfx-res ${cls}">${res}</span>
    </div>`;
  },

  /* ======================================================================
   *  VIEW: Fixtures
   * =================================================================== */
  fixtures(params) {
    const filter = params.f || "all";
    let list = Data.matches.slice().sort((a, b) => {
      const da = Engine.matchDate(a), db = Engine.matchDate(b);
      return (da && db ? da - db : 0) || a.id - b.id;
    });
    if (filter === "live") list = list.filter((m) => Engine.isLive(m));
    else if (filter === "upcoming") list = list.filter((m) => !m.finished && !Engine.isLive(m));
    else if (filter === "finished") list = list.filter((m) => Engine.isPlayed(m));
    else if (filter === "ko") list = list.filter((m) => m.type !== "group");

    const ownerFilter = params.o;
    if (ownerFilter) {
      const o = Data.owner(ownerFilter);
      const ids = new Set(o ? o.team_ids : []);
      list = list.filter((m) => ids.has(m.home_id) || ids.has(m.away_id));
    }

    // group by calendar day
    const byDay = {};
    list.forEach((m) => {
      const d = Engine.matchDate(m);
      const key = d ? this.dayKey(d) : "tbd";
      (byDay[key] = byDay[key] || []).push(m);
    });

    const filters = [
      ["all", "All"], ["live", "Live"], ["upcoming", "Upcoming"],
      ["finished", "Results"], ["ko", "Knockouts"],
    ]
      .map(
        ([k, lbl]) =>
          `<a class="fbtn ${filter === k ? "on" : ""}" href="#/fixtures${this.qs({ f: k, o: ownerFilter })}">${lbl}</a>`
      )
      .join("");

    const ownerOpts = Data.owners
      .map((o) => `<option value="${o.id}" ${ownerFilter === o.id ? "selected" : ""}>${this.esc(o.name)}</option>`)
      .join("");

    const body = Object.keys(byDay).length
      ? Object.keys(byDay)
          .sort()
          .map((day) => {
            const first = Engine.matchDate(byDay[day][0]);
            const label = day === "tbd" || !first ? "Date TBD" : this.fmtDayLong(first);
            return `<div class="day-group">
              <h3 class="day-h">${label} <span class="day-tz">${CONFIG.tzLabel}</span></h3>
              <div class="match-list">${byDay[day].map((m) => this.matchCard(m)).join("")}</div>
            </div>`;
          })
          .join("")
      : `<p class="empty">No matches match this filter yet.</p>`;

    return `<section class="view">
      <div class="view-head"><h1>Fixtures &amp; Results</h1></div>
      <div class="filterbar">
        <div class="fbtns">${filters}</div>
        <select class="osel" onchange="UI.onOwnerFilter(this.value, '${filter}')">
          <option value="">Every manager</option>${ownerOpts}
        </select>
      </div>
      ${body}
    </section>`;
  },
  onOwnerFilter(val, f) {
    location.hash = "#/fixtures" + this.qs({ f, o: val || undefined });
  },
  qs(obj) {
    const p = Object.entries(obj)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
    return p.length ? "?" + p.join("&") : "";
  },

  /* ======================================================================
   *  VIEW: Clashes (owner vs owner)
   * =================================================================== */
  clashes() {
    const live = Engine.liveMatches();
    const upcoming = Engine.upcoming(8);
    const played = Data.matches
      .filter((m) => Engine.isPlayed(m) && Engine.hasTeams(m))
      .sort((a, b) => b.id - a.id)
      .slice(0, 12);

    const duel = (m) => {
      const ho = Engine.hasTeams(m) ? Data.ownerForTeam(m.home_id) : null;
      const ao = Engine.hasTeams(m) ? Data.ownerForTeam(m.away_id) : null;
      const home = Engine.hasTeams(m) ? Data.team(m.home_id) : null;
      const away = Engine.hasTeams(m) ? Data.team(m.away_id) : null;
      const internal = ho && ao && ho.id === ao.id;
      const played = Engine.isPlayed(m);
      const live = Engine.isLive(m);
      const sc = played || live ? `${m.home_score ?? 0}–${m.away_score ?? 0}` : this.statusTag(m);
      return `<div class="duel ${internal ? "internal" : ""} ${live ? "is-live" : ""}">
        <div class="duel-side">
          ${this.ownerChip(ho)}
          <div class="duel-team">${flagImg(home, "dflag")}${this.esc(home ? home.name : "TBD")}</div>
        </div>
        <div class="duel-mid">
          <span class="duel-score">${sc}</span>
          <span class="duel-stage">${this.stageLabel(m.type)}${internal ? " · internal" : ""}</span>
        </div>
        <div class="duel-side right">
          ${this.ownerChip(ao)}
          <div class="duel-team">${flagImg(away, "dflag")}${this.esc(away ? away.name : "TBD")}</div>
        </div>
      </div>`;
    };

    // rivalry table: owner pairs who have actually met
    const M = Engine.h2hMatrix();
    const rivalries = [];
    const seen = new Set();
    Data.owners.forEach((a) => {
      Data.owners.forEach((b) => {
        if (a.id === b.id) return;
        const key = [a.id, b.id].sort().join("|");
        if (seen.has(key)) return;
        const x = M[a.id][b.id];
        if (x.games > 0) {
          seen.add(key);
          rivalries.push({ a, b, x, y: M[b.id][a.id] });
        }
      });
    });
    rivalries.sort((p, q) => q.x.games - p.x.games || (q.x.gf + q.x.ga) - (p.x.gf + p.x.ga));

    const rivalryHtml = rivalries.length
      ? `<div class="card"><h3>Head-to-head so far</h3><table class="h2h">
          <thead><tr><th>Manager</th><th></th><th>Manager</th><th>Played</th></tr></thead>
          <tbody>${rivalries
            .map(
              (r) => `<tr>
            <td>${this.ownerChip(r.a)}</td>
            <td class="h2h-score">${r.x.w}–${r.x.d}–${r.x.l}</td>
            <td>${this.ownerChip(r.b)}</td>
            <td>${r.x.games}</td>
          </tr>`
            )
            .join("")}</tbody></table></div>`
      : `<div class="hint">No managers have faced off yet — duels light up here as results land.</div>`;

    return `<section class="view">
      <div class="view-head"><h1>The Clashes</h1></div>
      <p class="lead">Every team is owned, so <b>every single match is a manager duel.</b> Here's who's going head-to-head.</p>
      ${live.length ? `<h3 class="sec">🔴 Live now</h3><div class="duel-list">${live.map(duel).join("")}</div>` : ""}
      <h3 class="sec">Next up</h3>
      <div class="duel-list">${upcoming.length ? upcoming.map(duel).join("") : `<p class="empty">No upcoming duels.</p>`}</div>
      ${rivalryHtml}
      ${played.length ? `<h3 class="sec">Recent duels</h3><div class="duel-list">${played.map(duel).join("")}</div>` : ""}
    </section>`;
  },

  /* ======================================================================
   *  VIEW: Groups
   * =================================================================== */
  groups() {
    const groups = Engine.groupStandings();
    const order = Object.keys(groups).sort();
    const cards = order
      .map((g) => {
        const rows = groups[g]
          .map((row) => {
            const owner = Data.ownerForTeam(row.team.id);
            return `<tr class="${row.qualified ? "qual" : ""} ${row.bestThird ? "third" : ""}">
              <td class="g-rank">${row.rank}</td>
              <td class="g-team">${flagImg(row.team, "gflag")}<span>${this.esc(row.team.name)}</span></td>
              <td class="g-owner">${owner ? `<span class="odot" style="--c:${this.color(owner.id)}" title="${this.esc(owner.name)}"></span>` : ""}</td>
              <td>${row.mp}</td><td>${row.w}</td><td>${row.d}</td><td>${row.l}</td>
              <td>${row.gf}</td><td>${row.ga}</td><td>${row.gd >= 0 ? "+" + row.gd : row.gd}</td>
              <td class="g-pts"><b>${row.pts}</b></td>
            </tr>`;
          })
          .join("");
        return `<div class="card group-card">
          <h3>Group ${this.esc(g)}</h3>
          <table class="gtab">
            <thead><tr><th></th><th>Team</th><th></th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      })
      .join("");
    return `<section class="view">
      <div class="view-head"><h1>Groups</h1></div>
      <div class="hint"><span class="leg qual"></span> through to Round of 32 &nbsp; <span class="leg third"></span> best third-placed · coloured dot = owner</div>
      <div class="group-grid">${cards}</div>
    </section>`;
  },

  /* ======================================================================
   *  VIEW: Stats
   * =================================================================== */
  stats() {
    const s = Engine.stats();
    const lb = Engine.leaderboard();

    const goalRank = lb.slice().sort((a, b) => b.agg.gf - a.agg.gf);
    const maxG = Math.max(...goalRank.map((r) => r.agg.gf), 1);
    const winRank = lb.slice().sort((a, b) => b.agg.w - a.agg.w || b.agg.gf - a.agg.gf);
    const maxW = Math.max(...winRank.map((r) => r.agg.w), 1);

    const goalBars = goalRank
      .map(
        (r) => `<div class="rankbar" style="--c:${this.color(r.owner.id)}">
        <span class="rb-name">${this.esc(r.owner.name)}</span>
        <span class="rb-track"><span class="rb-fill" style="width:${(r.agg.gf / maxG) * 100}%"></span></span>
        <span class="rb-val">${r.agg.gf}</span></div>`
      )
      .join("");
    const winBars = winRank
      .map(
        (r) => `<div class="rankbar" style="--c:${this.color(r.owner.id)}">
        <span class="rb-name">${this.esc(r.owner.name)}</span>
        <span class="rb-track"><span class="rb-fill" style="width:${(r.agg.w / maxW) * 100}%"></span></span>
        <span class="rb-val">${r.agg.w}<small>-${r.agg.d}-${r.agg.l}</small></span></div>`
      )
      .join("");

    const topTeams = s.topTeams.length
      ? `<table class="mini"><thead><tr><th>#</th><th>Team</th><th>Mgr</th><th>GF</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>${s.topTeams
          .map((t, i) => {
            const o = Data.ownerForTeam(t.team.id);
            return `<tr><td>${i + 1}</td>
              <td class="g-team">${flagImg(t.team, "gflag")}${this.esc(t.team.name)}</td>
              <td>${o ? `<span class="odot" style="--c:${this.color(o.id)}"></span>${this.esc(o.name)}` : ""}</td>
              <td class="pos">${t.gf}</td><td>${t.gd >= 0 ? "+" + t.gd : t.gd}</td><td><b>${t.pts}</b></td></tr>`;
          })
          .join("")}</tbody></table>`
      : `<p class="empty">No teams have played yet.</p>`;

    const matchLine = (x, label) => {
      if (!x) return "";
      const m = x.match;
      const h = Data.team(m.home_id), a = Data.team(m.away_id);
      return `<div class="bigstat">
        <span class="bs-label">${label}</span>
        <span class="bs-match">${flagImg(h, "gflag")}${this.esc(h ? h.name : "?")} <b>${m.home_score}–${m.away_score}</b> ${this.esc(a ? a.name : "?")}${flagImg(a, "gflag")}</span>
      </div>`;
    };

    return `<section class="view">
      <div class="view-head"><h1>Stats</h1></div>
      <div class="stat-cards">
        <div class="card stat"><div class="stat-n">${s.playedCount}<small>/${s.totalMatches}</small></div><div class="stat-l">matches played</div></div>
        <div class="card stat"><div class="stat-n">${s.goals}</div><div class="stat-l">goals scored</div></div>
        <div class="card stat"><div class="stat-n">${s.avgGoals.toFixed(2)}</div><div class="stat-l">goals / match</div></div>
      </div>

      <div class="stat-grid">
        <div class="card"><h3>⚽ Goal tally — by manager</h3><div class="rankbars">${goalBars}</div></div>
        <div class="card"><h3>🏆 Wins — by manager</h3><div class="rankbars">${winBars}</div></div>
      </div>

      <div class="card"><h3>Top scoring teams</h3>${topTeams}</div>

      <div class="card records">
        <h3>Records</h3>
        ${matchLine(s.biggest, "Biggest win (margin " + (s.biggest ? s.biggest.margin : 0) + ")")}
        ${matchLine(s.highest, "Highest scoring (" + (s.highest ? s.highest.total : 0) + " goals)")}
        ${!s.biggest ? `<p class="empty">Records appear once results land.</p>` : ""}
      </div>
    </section>`;
  },

  /* -- owner-filter helper for fixtures select ---------------------------- */
};
