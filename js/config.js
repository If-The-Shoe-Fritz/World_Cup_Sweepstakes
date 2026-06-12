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
  // Live scores are pulled from ESPN by a GitHub Action and committed to /data,
  // so the browser just re-reads our own (always-fresh) local files. The old
  // in-browser overlay is off — leave it disabled unless you wire a CORS-safe
  // source of your own.
  remote: { enabled: false },
  refreshSeconds: 90, // how often the open page re-reads /data for new scores

  /* -- SCORING SYSTEM ------------------------------------------------------
   *  Every owner banks points from their three teams. Change the numbers and
   *  the whole site (leaderboard, breakdowns, podium) recomputes instantly.
   * --------------------------------------------------------------------- */
  scoring: {
    result: { win: 3, draw: 1, loss: 0 }, // per finished match, per team
    goalFor: 1, // points for every goal one of your teams scores
    goalAgainst: 0, // points (usually negative) per goal conceded; 0 = ignore
    cleanSheet: 0, // bonus for a team keeping a clean sheet in a finished match

    // Escalating bonuses banked the moment a team reaches each stage.
    // They are cumulative — a finalist has banked every milestone below it.
    advance: {
      r32: 3, // made the Round of 32 (survived the group)
      r16: 5, // Round of 16
      qf: 8, // Quarter-final
      sf: 13, // Semi-final
      final: 21, // Final
    },
    champion: 34, // winning the whole thing
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
