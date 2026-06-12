# 🏆 World Cup 2026 Sweepstakes

An interactive, auto-updating website for our FIFA World Cup 2026 sweepstakes —
**16 mates, 48 teams, one trophy.** Live leaderboard, manager-vs-manager
clashes, goal tallies, group standings and stats, all driven by real match data.

Every team in the tournament is owned by one of the lads, which means **every
single match is a head-to-head between two managers**. The site leans right into
that.

---

## 📲 What's in it

| View | What you get |
|------|--------------|
| **🏆 Table** | The headline leaderboard with a top-3 podium, full standings and a live countdown to the next kick-off. |
| **👥 Managers** | Every owner, their three teams, and a one-tap drill-down into a full points breakdown + each team's fixtures and form. |
| **📅 Fixtures** | The whole 104-match schedule with owner badges on every team. Filter by live / upcoming / results / knockouts / manager. |
| **⚔️ Clashes** | Every match reframed as *Owner A vs Owner B*, plus a running head-to-head record between managers. |
| **🗂️ Groups** | All 12 live group tables (computed from results) showing who's through to the Round of 32, with owner colours. |
| **📊 Stats** | Goal tally by manager, win tally, top-scoring teams, biggest wins and more. |

It's mobile-first, dark, and updates itself during the tournament — just send
the lads the link.

---

## 🧮 How the scoring works

Each manager banks points from their three teams. It rewards winning, scoring
goals, **and going deep** in the knockouts:

| Source | Points |
|--------|-------:|
| Win | **3** |
| Draw | **1** |
| Every goal a team scores | **+1** |
| Reach Round of 32 (survive the group) | **+3** |
| Reach Round of 16 | **+5** |
| Reach Quarter-final | **+8** |
| Reach Semi-final | **+13** |
| Reach Final | **+21** |
| **Win the whole thing** 👑 | **+34** |

Progression bonuses are **cumulative** — a finalist has already banked every
milestone below it. Goals and W/D/L also get their own dedicated tallies on the
Stats page.

**Want different numbers?** It's all in [`js/config.js`](js/config.js) under
`scoring` — change a value and the entire site (leaderboard, podium, breakdowns)
recomputes instantly. No build step.

---

## 🚀 Going live (GitHub Pages)

The site is plain static files, so GitHub Pages hosts it for free:

1. Merge this branch into **`main`**.
2. Repo **Settings → Pages**.
3. Under **Build and deployment**, set **Source: _Deploy from a branch_**,
   **Branch: `main`**, folder **`/ (root)`**, then **Save**.
4. Wait ~1 minute. Your link will be:
   **`https://if-the-shoe-fritz.github.io/world_cup_sweepstakes/`**

Send that to the group chat. Done.

---

## 🔄 How live scores update

Match data lives in [`/data`](data) as plain JSON. A GitHub Action,
[`update-data.yml`](.github/workflows/update-data.yml), runs **every 15 minutes**
during the tournament: it pulls the latest scores from the upstream
[worldcup2026 API repo](https://github.com/rezarahiminia/worldcup2026),
rebuilds the data files, and commits them. Pages redeploys automatically, so the
site stays current with zero effort.

- **Trigger a refresh by hand:** repo **Actions → Refresh match data → Run
  workflow**.
- **Change the cadence:** edit the `cron` line in the workflow.
- The site also tries to pull fresh scores straight from upstream in the
  browser, so an open tab refreshes itself every 90s too.

> The Action needs write access to push commits — that's on by default via the
> built-in `GITHUB_TOKEN`. If you've turned on branch protection for `main`,
> allow the Action to push (or point Pages at a different branch).

---

## 🛠️ Running it locally

`fetch()` needs a web server (opening `index.html` straight off disk won't load
the data), so:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

To pull the latest scores into `/data` yourself:

```bash
python3 scripts/update_data.py
```

(Standard-library Python only — nothing to install.)

---

## 📁 Project layout

```
index.html              # shell
css/styles.css          # all styling (dark, mobile-first)
js/
  config.js             # ⭐ scoring system, branding, refresh settings
  data.js               # loads /data, overlays live scores, flag helpers
  engine.js             # standings, owner scoring, clashes, stats
  ui.js                 # all views + rendering
  app.js                # router, auto-refresh, countdown
data/                   # bundled match data (auto-refreshed by the Action)
scripts/update_data.py  # pulls + normalises upstream data
.github/workflows/      # the auto-refresh job
```

---

## 👥 The draw

16 managers × 3 teams = all 48 World Cup 2026 nations. The mapping lives in
`data/owners.json` (and is rebuilt by `scripts/update_data.py` from the original
draw). To change a pick, edit the `DRAW` list in that script and re-run it.

Data courtesy of the open-source
[worldcup2026 API](https://github.com/rezarahiminia/worldcup2026). Built for the
lads 🍺
