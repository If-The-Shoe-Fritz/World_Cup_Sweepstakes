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
    // "MM/DD/YYYY HH:MM" (venue local time) -> Date
    if (!m.date) return null;
    const [d, t] = m.date.split(" ");
    const [mo, da, yr] = d.split("/").map(Number);
    const [h, mi] = (t || "00:00").split(":").map(Number);
    return new Date(yr, mo - 1, da, h, mi);
  },

  /* -- per-team record from every finished match -------------------------- */
  teamRecords() {
    const rec = {};
    Data.teams.forEach((t) => {
      rec[t.id] = {
        team: t,
        mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, cs: 0,
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
      const hs = m.home_score, as = m.away_score;
      h.mp++; a.mp++;
      h.gf += hs; h.ga += as;
      a.gf += as; a.ga += hs;
      if (as === 0) h.cs++;
      if (hs === 0) a.cs++;
      if (hs > as) {
        h.w++; a.l++; h.pts += 3; h.form.push("W"); a.form.push("L");
      } else if (hs < as) {
        a.w++; h.l++; a.pts += 3; a.form.push("W"); h.form.push("L");
      } else {
        h.d++; a.d++; h.pts++; a.pts++; h.form.push("D"); a.form.push("D");
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
      const agg = { mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, cs: 0 };
      teams.forEach((t) => {
        agg.mp += t.mp; agg.w += t.w; agg.d += t.d; agg.l += t.l;
        agg.gf += t.gf; agg.ga += t.ga; agg.cs += t.cs;
      });

      const resultPts =
        agg.w * S.result.win + agg.d * S.result.draw + agg.l * S.result.loss;
      const goalPts = agg.gf * S.goalFor + agg.ga * S.goalAgainst;
      const csPts = agg.cs * S.cleanSheet;

      // cumulative progression bonuses banked across the owner's teams
      let advancePts = 0;
      const teamStages = {};
      o.team_ids.forEach((id) => {
        const reached = prog.reached[id];
        let banked = 0;
        CONFIG.progression.forEach((s) => {
          if (s !== "group" && reached.has(s)) banked += S.advance[s] || 0;
        });
        if (prog.championId === id) banked += S.champion;
        advancePts += banked;
        teamStages[id] = { deepest: prog.deepest[id], banked };
      });

      const total = resultPts + goalPts + csPts + advancePts;
      return {
        owner: o,
        teams,
        agg,
        breakdown: { resultPts, goalPts, csPts, advancePts },
        teamStages,
        champion: o.team_ids.includes(prog.championId),
        total,
      };
    });

    rows.sort(
      (a, b) =>
        b.total - a.total ||
        b.breakdown.advancePts - a.breakdown.advancePts ||
        b.agg.gf - a.agg.gf ||
        a.owner.name.localeCompare(b.owner.name)
    );
    // dense-ish ranking with ties sharing a rank
    let lastTotal = null, lastRank = 0;
    rows.forEach((r, i) => {
      if (r.total !== lastTotal) {
        lastRank = i + 1;
        lastTotal = r.total;
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
};
