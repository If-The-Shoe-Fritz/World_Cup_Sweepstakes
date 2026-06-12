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

  async load() {
    const j = async (f) => {
      const r = await fetch(CONFIG.localData + f + "?t=" + Date.now());
      if (!r.ok) throw new Error("Failed to load " + f);
      return r.json();
    };
    const [teams, matches, stadiums, grouptables, owners, meta] =
      await Promise.all([
        j("teams.json"),
        j("matches.json"),
        j("stadiums.json"),
        j("grouptables.json"),
        j("owners.json"),
        j("meta.json").catch(() => ({})),
      ]);

    this.teams = teams;
    this.matches = matches;
    this.stadiums = stadiums;
    this.grouptables = grouptables;
    this.owners = owners;
    this.meta = meta || {};
    this._index();

    // best-effort live overlay (never breaks the page if it fails)
    await this._overlayRemote();
    return this;
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
  },

  /* Pull the upstream matches file directly in the browser and merge any
   * fresher scores on top of the bundled data. Silent on failure. */
  async _overlayRemote() {
    if (!CONFIG.remote || !CONFIG.remote.enabled) return false;
    try {
      const url = CONFIG.remote.base + CONFIG.remote.files.matches + "?t=" + Date.now();
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return false;
      const raw = await r.json();
      const sc = (v) => {
        const n = parseInt(v, 10);
        return Number.isNaN(n) ? null : n;
      };
      const live = {};
      raw.forEach((m) => {
        live[parseInt(m.id, 10)] = {
          home_id: m.home_team_id,
          away_id: m.away_team_id,
          home_score: sc(m.home_score),
          away_score: sc(m.away_score),
          finished: String(m.finished).toUpperCase() === "TRUE",
          status: m.time_elapsed || "notstarted",
        };
      });
      let changed = false;
      this.matches.forEach((m) => {
        const u = live[m.id];
        if (!u) return;
        // adopt upstream once anything has actually progressed for that match
        const upstreamProgressed =
          u.finished || (u.status && u.status !== "notstarted");
        const slotsResolved = u.home_id !== "0" && u.away_id !== "0";
        if (upstreamProgressed || slotsResolved) {
          if (slotsResolved) {
            m.home_id = u.home_id;
            m.away_id = u.away_id;
          }
          m.home_score = u.home_score;
          m.away_score = u.away_score;
          m.finished = u.finished;
          m.status = u.status;
          changed = true;
        }
      });
      if (changed) this.meta.live = true;
      return changed;
    } catch (e) {
      return false;
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
