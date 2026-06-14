/* ===========================================================================
 *  Data layer — loads the bundled snapshot, optionally overlays live scores
 *  from the upstream repo, and exposes tidy lookup helpers.
 * ======================================================================== */

const Data = {
  teams: [],
  matches: [],
  stadiums: [],
  grouptables: [],
  owners: [],
  meta: {},

  byTeam: {}, // id -> team
  byStadium: {}, // id -> stadium
  ownerOfTeam: {}, // team id -> owner
  byOwner: {}, // owner id -> owner

  async _loadLocal() {
    const j = async (f) => {
      const r = await fetch(CONFIG.localData + f + "?t=" + Date.now());
      if (!r.ok) throw new Error("Failed to load " + f);
      return r.json();
    };
    const [teams, matches, stadiums, grouptables, owners, meta, players] =
      await Promise.all([
        j("teams.json"),
        j("matches.json"),
        j("stadiums.json"),
        j("grouptables.json"),
        j("owners.json"),
        j("meta.json").catch(() => ({})),
        j("players.json").catch(() => ({})),
      ]);

    this.teams = teams;
    this.matches = matches;
    this.stadiums = stadiums;
    this.grouptables = grouptables;
    this.owners = owners;
    this.meta = meta || {};
    this.playersRaw = players || {};
    this._index();
  },

  async load() {
    await this._loadLocal();
    await this.fetchLive(); // best-effort real-time overlay
    return this;
  },

  // re-read the committed /data files (the Action keeps them fresh)
  async reloadLocal() {
    await this._loadLocal();
  },

  _index() {
    this.byTeam = {};
    this.teams.forEach((t) => (this.byTeam[t.id] = t));
    this.byStadium = {};
    this.stadiums.forEach((s) => (this.byStadium[s.id] = s));
    this.byOwner = {};
    this.ownerOfTeam = {};
    this.owners.forEach((o) => {
      this.byOwner[o.id] = o;
      o.team_ids.forEach((tid) => (this.ownerOfTeam[tid] = o));
    });
    // curated "players to watch", keyed by team id (players.json is by name)
    this.playersByTeam = {};
    this.teams.forEach((t) => {
      const list = this.playersRaw[t.name];
      if (Array.isArray(list)) this.playersByTeam[t.id] = list;
    });
  },

  /* ---- Live overlay straight from ESPN -----------------------------------
   * Pulls the public ESPN scoreboard in the browser and overlays live scores
   * onto our fixtures in real time, so liveness doesn't depend on the 15-min
   * GitHub Action. Matches ESPN events to our teams by name/code. Entirely
   * best-effort: any failure (incl. CORS) silently leaves committed data. */
  _norm(s) {
    // NFKD splits accents into combining marks; the [^a-z0-9] strip then drops
    // them, so "Türkiye" -> "turkiye" and "Curaçao" -> "curacao".
    return s ? s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  },
  _nameLut() {
    if (this.__lut) return this.__lut;
    const SYN = {
      unitedstates: ["usa", "usmnt", "unitedstatesofamerica", "us"],
      southkorea: ["korearepublic", "republicofkorea", "korea", "kor"],
      czechrepublic: ["czechia", "czech"],
      turkey: ["turkiye"],
      ivorycoast: ["cotedivoire"],
      capeverde: ["caboverde"],
      bosniaandherzegovina: ["bosniaherzegovina", "bosnia", "bih"],
      democraticrepublicofthecongo: ["congodr", "drcongo", "drc", "congokinshasa"],
      iran: ["iriran"],
      saudiarabia: ["ksa"],
      netherlands: ["holland"],
    };
    const lut = {};
    this.teams.forEach((t) => {
      lut[this._norm(t.name)] = t.id;
      if (t.code && lut[this._norm(t.code)] == null) lut[this._norm(t.code)] = t.id;
    });
    Object.entries(SYN).forEach(([canon, vars]) => {
      if (lut[canon] != null) vars.forEach((v) => {
        const k = this._norm(v);
        if (lut[k] == null) lut[k] = lut[canon];
      });
    });
    this.__lut = lut;
    return lut;
  },
  async fetchLive() {
    if (!CONFIG.live || !CONFIG.live.enabled) return false;
    try {
      const lut = this._nameLut();
      const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
      const now = Date.now();
      // yesterday..tomorrow (UTC) covers the venue-timezone spread
      const url = `${CONFIG.live.base}?dates=${fmt(new Date(now - 864e5))}-${fmt(new Date(now + 864e5))}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return false;
      const data = await r.json();

      const pair = {};
      this.matches.forEach((m) => {
        if (m.home_id && m.away_id && m.home_id !== "0" && m.away_id !== "0")
          pair[[m.home_id, m.away_id].sort().join("|")] = m;
      });

      let changed = false;
      (data.events || []).forEach((ev) => {
        try {
          const comp = (ev.competitions || [])[0];
          if (!comp) return;
          const type = ((ev.status || comp.status || {}).type) || {};
          if (type.state === "pre") return; // not started
          const sides = {};
          (comp.competitors || []).forEach((c) => {
            const team = c.team || {};
            const cand = [team.displayName, team.shortDisplayName, team.name, team.location, team.abbreviation];
            let tid = null;
            for (const nm of cand) {
              const id = nm && lut[this._norm(nm)];
              if (id != null) { tid = id; break; }
            }
            if (tid == null) return;
            const sc = parseInt(c.score, 10);
            sides[c.homeAway || "home"] = { id: tid, score: Number.isNaN(sc) ? 0 : sc };
          });
          if (!sides.home || !sides.away) return;
          const m = pair[[sides.home.id, sides.away.id].sort().join("|")];
          if (!m) return;
          const finished = !!type.completed || type.state === "post";
          const status = finished ? "finished" : (type.shortDetail || "live");
          const map = {};
          map[sides.home.id] = sides.home.score;
          map[sides.away.id] = sides.away.score;
          const nh = map[m.home_id], na = map[m.away_id];
          if (m.home_score !== nh || m.away_score !== na || m.finished !== finished || m.status !== status) {
            m.home_score = nh; m.away_score = na; m.finished = finished; m.status = status;
            changed = true;
          }
        } catch (e) { /* skip a bad event */ }
      });
      if (changed) { this.meta.live = true; this.meta.live_at = new Date().toISOString(); }
      return changed;
    } catch (e) {
      return false; // offline / CORS / ESPN down → keep committed data
    }
  },

  team(id) {
    return this.byTeam[id] || null;
  },
  owner(id) {
    return this.byOwner[id] || null;
  },
  stadium(id) {
    return this.byStadium[id] || null;
  },
  ownerForTeam(id) {
    return this.ownerOfTeam[id] || null;
  },
  playersFor(id) {
    return this.playersByTeam[id] || [];
  },
};

/* ---- Flag helpers --------------------------------------------------------
 * Use the CDN image, but fall back to an emoji flag from the ISO-2 code so
 * the site still looks right offline. */
function emojiFlag(iso2) {
  if (!iso2 || iso2.length !== 2) return "🏳️";
  const A = 0x1f1e6;
  const cc = iso2.toUpperCase();
  return String.fromCodePoint(
    A + (cc.charCodeAt(0) - 65),
    A + (cc.charCodeAt(1) - 65)
  );
}

function flagImg(team, cls) {
  if (!team) return `<span class="${cls || "flag"}">🏳️</span>`;
  const emoji = emojiFlag(team.iso2);
  const src = team.flag || "";
  if (!src) return `<span class="${cls || "flag"} flag-emoji">${emoji}</span>`;
  return `<img class="${cls || "flag"}" src="${src}" alt="${team.code}" loading="lazy" onerror="this.outerHTML='<span class=\\'${cls || "flag"} flag-emoji\\'>${emoji}</span>'">`;
}
