/* ===========================================================================
 *  Engine — turns raw matches into everything the UI shows. Pure functions of
 *  Data.*, recomputed on every refresh so any score change flows through.
 * ======================================================================== */

const Engine = {
  /* -- low level helpers -------------------------------------------------- */
  isPlayed(m) {
    return (
      m.finished && m.home_score !== null && m.away_score !== null
    );
  },
  isLive(m) {
    return !m.finished && m.status && m.status !== "notstarted";
  },
  hasTeams(m) {
    return m.home_id && m.away_id && m.home_id !== "0" && m.away_id !== "0";
  },
  matchDate(m) {
    // "MM/DD/YYYY HH:MM" is the VENUE's local wall time. Turn it into a true
    // UTC instant using that venue's offset, so it can be shown in any timezone.
    if (!m.date) return null;
    const [d, t] = m.date.split(" ");
    const [mo, da, yr] = d.split("/").map(Number);
    const [h, mi] = (t || "00:00").split(":").map(Number);
    const off = (CONFIG.venueOffset && CONFIG.venueOffset[m.stadium_id]) || 0;
    // UTC = local - offset (offset is negative for the Americas)
    return new Date(Date.UTC(yr, mo - 1, da, h - off, mi));
  },

  /* -- per-team record from every finished match -------------------------- */
  teamRecords() {
    const rec = {};
    Data.teams.forEach((t) => {
      rec[t.id] = {
        team: t,
        mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, cs: 0,
        gw: 0, gdr: 0, gl: 0, // group-stage win / draw / loss (these earn points)
        form: [], // recent results, oldest->newest
      };
    });
    const played = Data.matches
      .filter((m) => this.isPlayed(m) && this.hasTeams(m))
      .sort((a, b) => a.id - b.id);
    played.forEach((m) => {
      const h = rec[m.home_id];
      const a = rec[m.away_id];
      if (!h || !a) return;
      const grp = m.type === "group";
      const hs = m.home_score, as = m.away_score;
      h.mp++; a.mp++;
      h.gf += hs; h.ga += as;
      a.gf += as; a.ga += hs;
      if (as === 0) h.cs++;
      if (hs === 0) a.cs++;
      if (hs > as) {
        h.w++; a.l++; h.pts += 3; h.form.push("W"); a.form.push("L");
        if (grp) { h.gw++; a.gl++; }
      } else if (hs < as) {
        a.w++; h.l++; a.pts += 3; a.form.push("W"); h.form.push("L");
        if (grp) { a.gw++; h.gl++; }
      } else {
        h.d++; a.d++; h.pts++; a.pts++; h.form.push("D"); a.form.push("D");
        if (grp) { h.gdr++; a.gdr++; }
      }
    });
    Object.values(rec).forEach((r) => (r.gd = r.gf - r.ga));
    return rec;
  },

  /* -- live group standings (group matches only) -------------------------- */
  groupStandings() {
    const rec = {};
    Data.teams.forEach((t) => {
      rec[t.id] = {
        team: t, mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0,
      };
    });
    Data.matches
      .filter((m) => m.type === "group" && this.isPlayed(m) && this.hasTeams(m))
      .forEach((m) => {
        const h = rec[m.home_id], a = rec[m.away_id];
        if (!h || !a) return;
        h.mp++; a.mp++;
        h.gf += m.home_score; h.ga += m.away_score;
        a.gf += m.away_score; a.ga += m.home_score;
        if (m.home_score > m.away_score) { h.w++; a.l++; h.pts += 3; }
        else if (m.home_score < m.away_score) { a.w++; h.l++; a.pts += 3; }
        else { h.d++; a.d++; h.pts++; a.pts++; }
      });
    Object.values(rec).forEach((r) => (r.gd = r.gf - r.ga));

    // build group -> sorted rows
    const groups = {};
    Data.teams.forEach((t) => {
      (groups[t.group] = groups[t.group] || []).push(rec[t.id]);
    });
    const cmp = (a, b) =>
      b.pts - a.pts || b.gd - a.gd || b.gf - a.gf ||
      a.team.name.localeCompare(b.team.name);
    Object.keys(groups).forEach((g) => {
      groups[g].sort(cmp);
      groups[g].forEach((row, i) => (row.rank = i + 1));
    });

    // best third-placed teams advance too (8 of them in 2026)
    const thirds = Object.values(groups)
      .map((rows) => rows[2])
      .filter(Boolean)
      .sort(cmp);
    const bestThirdIds = new Set(thirds.slice(0, 8).map((r) => r.team.id));
    Object.values(groups).forEach((rows) =>
      rows.forEach((row) => {
        row.qualified = row.rank <= 2 || bestThirdIds.has(row.team.id);
        row.bestThird = row.rank === 3 && bestThirdIds.has(row.team.id);
      })
    );
    return groups;
  },

  /* -- deepest knockout stage each team reached --------------------------- */
  progression() {
    const reached = {}; // team id -> Set(stage keys)
    Data.teams.forEach((t) => (reached[t.id] = new Set()));
    Data.matches.forEach((m) => {
      if (!CONFIG.progression.includes(m.type)) return;
      [m.home_id, m.away_id].forEach((id) => {
        if (id && id !== "0" && reached[id]) reached[id].add(m.type);
      });
    });
    // champion = winner of the finished final
    let championId = null;
    const final = Data.matches.find((m) => m.type === "final");
    if (final && this.isPlayed(final) && this.hasTeams(final)) {
      if (final.home_score > final.away_score) championId = final.home_id;
      else if (final.away_score > final.home_score) championId = final.away_id;
      else if (final.home_pens != null && final.away_pens != null)
        championId = final.home_pens > final.away_pens ? final.home_id : final.away_id;
    }
    const deepest = {};
    Data.teams.forEach((t) => {
      let best = "group";
      CONFIG.progression.forEach((s) => {
        if (reached[t.id].has(s)) best = s;
      });
      deepest[t.id] = best;
    });
    return { reached, deepest, championId };
  },

  /* -- the whole leaderboard ---------------------------------------------- */
  leaderboard() {
    const rec = this.teamRecords();
    const prog = this.progression();
    const S = CONFIG.scoring;

    const rows = Data.owners.map((o) => {
      const teams = o.team_ids.map((id) => rec[id]).filter(Boolean);
      const agg = { mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, cs: 0, gw: 0, gdr: 0, gl: 0 };
      teams.forEach((t) => {
        agg.mp += t.mp; agg.w += t.w; agg.d += t.d; agg.l += t.l;
        agg.gf += t.gf; agg.ga += t.ga; agg.cs += t.cs;
        agg.gw += t.gw; agg.gdr += t.gdr; agg.gl += t.gl;
      });

      // points come from GROUP results only (knockouts via progression bonus)
      const resultPts =
        agg.gw * S.result.win + agg.gdr * S.result.draw + agg.gl * S.result.loss;

      // cumulative progression bonuses + per-team point contribution
      let advancePts = 0;
      const teamStages = {};
      const contributions = [];
      o.team_ids.forEach((id) => {
        const tr = rec[id];
        const reached = prog.reached[id];
        let banked = 0;
        CONFIG.progression.forEach((s) => {
          if (s === "group" || !reached.has(s)) return;
          // the final is worth the winner's value if won, else the runner-up's
          if (s === "final") banked += prog.championId === id ? S.champion : (S.advance.final || 0);
          else banked += S.advance[s] || 0;
        });
        advancePts += banked;
        teamStages[id] = { deepest: prog.deepest[id], banked };

        const tResult = tr.gw * S.result.win + tr.gdr * S.result.draw + tr.gl * S.result.loss;
        contributions.push({
          team: tr.team,
          rec: tr,
          resultPts: tResult,
          banked,
          deepest: prog.deepest[id],
          champion: prog.championId === id,
          total: tResult + banked,
        });
      });
      contributions.sort(
        (a, b) =>
          b.total - a.total ||
          b.rec.gf - a.rec.gf ||
          b.rec.gd - a.rec.gd ||
          a.team.name.localeCompare(b.team.name)
      );

      const total = resultPts + advancePts;
      return {
        owner: o,
        teams,
        agg,
        breakdown: { resultPts, advancePts, goals: agg.gf },
        teamStages,
        contributions, // owner's teams ranked by points earned
        mvp: contributions[0] && contributions[0].total > 0 ? contributions[0] : null,
        champion: o.team_ids.includes(prog.championId),
        total,
      };
    });

    // rank by points, then total goals scored (÷100 tiebreaker), then goal diff
    rows.sort(
      (a, b) =>
        b.total - a.total ||
        b.agg.gf - a.agg.gf ||
        (b.agg.gf - b.agg.ga) - (a.agg.gf - a.agg.ga) ||
        a.owner.name.localeCompare(b.owner.name)
    );
    // ties share a rank only when points AND goals AND goal-diff all match
    let prev = null, lastRank = 0;
    rows.forEach((r, i) => {
      const gd = r.agg.gf - r.agg.ga;
      if (!prev || prev.total !== r.total || prev.gf !== r.agg.gf || prev.gd !== gd) {
        lastRank = i + 1;
        prev = { total: r.total, gf: r.agg.gf, gd };
      }
      r.rank = lastRank;
    });
    return rows;
  },

  /* -- every match reframed as an owner-vs-owner clash -------------------- */
  clashes() {
    return Data.matches
      .map((m) => {
        const ho = this.hasTeams(m) ? Data.ownerForTeam(m.home_id) : null;
        const ao = this.hasTeams(m) ? Data.ownerForTeam(m.away_id) : null;
        return { match: m, homeOwner: ho, awayOwner: ao };
      });
  },

  /* -- head-to-head record between every pair of owners ------------------- */
  h2hMatrix() {
    const M = {};
    Data.owners.forEach((a) => {
      M[a.id] = {};
      Data.owners.forEach((b) => {
        if (a.id !== b.id) M[a.id][b.id] = { w: 0, d: 0, l: 0, gf: 0, ga: 0, games: 0 };
      });
    });
    Data.matches.forEach((m) => {
      if (!this.isPlayed(m) || !this.hasTeams(m)) return;
      const ho = Data.ownerForTeam(m.home_id);
      const ao = Data.ownerForTeam(m.away_id);
      if (!ho || !ao || ho.id === ao.id) return;
      const hs = m.home_score, as = m.away_score;
      const X = M[ho.id][ao.id], Y = M[ao.id][ho.id];
      X.games++; Y.games++;
      X.gf += hs; X.ga += as; Y.gf += as; Y.ga += hs;
      if (hs > as) { X.w++; Y.l++; }
      else if (hs < as) { X.l++; Y.w++; }
      else { X.d++; Y.d++; }
    });
    return M;
  },

  /* -- tournament-wide stats --------------------------------------------- */
  stats() {
    const rec = this.teamRecords();
    const played = Data.matches.filter(
      (m) => this.isPlayed(m) && this.hasTeams(m)
    );
    const goals = played.reduce((s, m) => s + m.home_score + m.away_score, 0);

    const topTeams = Object.values(rec)
      .filter((r) => r.mp > 0)
      .sort((a, b) => b.gf - a.gf || b.gd - a.gd)
      .slice(0, 10);

    let biggest = null;
    played.forEach((m) => {
      const margin = Math.abs(m.home_score - m.away_score);
      if (!biggest || margin > biggest.margin) biggest = { match: m, margin };
    });
    let highest = null;
    played.forEach((m) => {
      const tot = m.home_score + m.away_score;
      if (!highest || tot > highest.total) highest = { match: m, total: tot };
    });

    return {
      playedCount: played.length,
      totalMatches: Data.matches.length,
      goals,
      avgGoals: played.length ? goals / played.length : 0,
      topTeams,
      biggest,
      highest,
    };
  },

  /* -- handy schedule slices --------------------------------------------- */
  upcoming(limit) {
    const now = new Date();
    const future = Data.matches
      .filter((m) => !m.finished)
      .map((m) => ({ m, d: this.matchDate(m) }))
      .filter((x) => x.d)
      .sort((a, b) => a.d - b.d);
    const next = future.filter((x) => x.d >= now);
    const list = (next.length ? next : future).map((x) => x.m);
    return limit ? list.slice(0, limit) : list;
  },
  liveMatches() {
    return Data.matches.filter((m) => this.isLive(m));
  },

  // The match to feature in the banner: a live one (per data), else one that has
  // kicked off by the clock but whose data hasn't caught up yet, else the next
  // upcoming. Stops a just-started match being skipped in favour of a later one.
  currentMatch() {
    const live = this.liveMatches();
    if (live.length) return { match: live[0], live: true };
    const now = Date.now();
    const started = Data.matches
      .filter((m) => !m.finished && this.hasTeams(m))
      .map((m) => ({ m, d: this.matchDate(m) }))
      .filter((x) => x.d && x.d.getTime() <= now && now - x.d.getTime() < 3 * 3600 * 1000)
      .sort((a, b) => b.d - a.d); // most recently kicked-off first
    if (started.length) return { match: started[0].m, live: true, awaiting: true };
    const up = this.upcoming(1)[0];
    return up ? { match: up, live: false } : null;
  },
};
