/* ===========================================================================
 *  World Cup 2026 Sweepstakes — configuration
 *  Tweak anything in here to change how the competition is scored.
 * ======================================================================== */

const CONFIG = {
  /* -- Branding ------------------------------------------------------------ */
  title: "World Cup 2026 Sweepstakes",
  subtitle: "16 mates · 48 teams · one trophy",

  /* -- Where match data comes from ----------------------------------------
   *  The site reads the bundled /data files first (always works, even offline).
   *  A GitHub Action keeps those files fresh from the upstream repo, so during
   *  the tournament scores update automatically. You can also hand-edit
   *  data/matches.json to enter a score yourself.
   * --------------------------------------------------------------------- */
  localData: "data/",
  // The committed /data files (kept fresh by the GitHub Action) are the base.
  // On top of that, the browser pulls live scores straight from ESPN every
  // refresh, so in-progress matches update in ~1 min instead of waiting on the
  // Action. Falls back silently to /data if ESPN is unreachable/CORS-blocked.
  live: {
    enabled: true,
    base: "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard",
  },
  refreshSeconds: 60, // how often the open page re-pulls scores

  /* -- SCORING SYSTEM ------------------------------------------------------
   *  Every owner banks points from their three teams. Change the numbers and
   *  the whole site (leaderboard, breakdowns, podium) recomputes instantly.
   * --------------------------------------------------------------------- */
  scoring: {
    // Points come from GROUP matches only. Knockout results are rewarded purely
    // through the progression bonuses below.
    result: { win: 3, draw: 1, loss: 0 },

    // Goals are NOT points — total goals scored only break ties between owners
    // on equal points (then goal difference). So leave these at 0.
    goalFor: 0,
    goalAgainst: 0,
    cleanSheet: 0,

    // Cumulative bonuses: a team banks each stage's value as it advances
    // (e.g. reaching the QF = 4 + 6 + 8 = 18).
    advance: {
      r32: 4, // made the Round of 32 (survived the group)
      r16: 6, // Round of 16
      qf: 8, // Quarter-final
      sf: 12, // Semi-final
      final: 18, // reached the final and lost (Runner-up)
    },
    champion: 22, // won the final (Winner) — replaces the runner-up value
  },

  /* -- Stage metadata (labels + order) ------------------------------------ */
  stages: [
    { key: "group", label: "Group Stage", short: "Groups" },
    { key: "r32", label: "Round of 32", short: "R32" },
    { key: "r16", label: "Round of 16", short: "R16" },
    { key: "qf", label: "Quarter-finals", short: "QF" },
    { key: "sf", label: "Semi-finals", short: "SF" },
    { key: "third", label: "Third-place Play-off", short: "3rd" },
    { key: "final", label: "Final", short: "Final" },
  ],
  // order used for "deepest stage reached" (third-place ignored for progression)
  progression: ["group", "r32", "r16", "qf", "sf", "final"],

  /* Kick-off times are stored as each venue's LOCAL time. We convert them to a
   * single display timezone so everyone sees the same clock. The lads are in
   * Australia, so default to AEST. `venueOffset` is each stadium's UTC offset
   * for the Jun–Jul 2026 window (US/Canada on summer time; Mexico has no DST). */
  displayTZ: "Australia/Brisbane", // AEST year-round (no daylight saving)
  tzLabel: "AEST",
  venueOffset: {
    "1": -6, "2": -6, "3": -6,             // Mexico (CST, no DST)
    "4": -5, "5": -5, "6": -5,             // US Central (CDT)
    "7": -4, "8": -4, "9": -4, "10": -4, "11": -4, "12": -4, // US/Canada Eastern (EDT)
    "13": -7, "14": -7, "15": -7, "16": -7, // Pacific (PDT)
  },
};

/* A distinct accent colour per owner, evenly spread around the colour wheel,
 * so each manager has a consistent identity across every view. */
CONFIG.ownerColors = (function () {
  const colors = {};
  const ids = Array.from({ length: 16 }, (_, i) => "o" + (i + 1));
  ids.forEach((id, i) => {
    const hue = Math.round((i * 360) / ids.length);
    colors[id] = `hsl(${hue}, 70%, 55%)`;
  });
  return colors;
})();
