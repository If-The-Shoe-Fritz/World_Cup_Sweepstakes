#!/usr/bin/env python3
"""
Keep the sweepstakes data current with live World Cup 2026 results.

The fixtures / teams / groups / venues were verified against the real tournament
and are frozen in /data. This script overlays *live scores* on top of them,
pulled from ESPN's free public soccer API (no key, no signup, real-time).

  Default:      python scripts/update_data.py
                -> fetch live results from ESPN, merge onto data/matches.json

  Rebuild:      python scripts/update_data.py --rebuild
                -> regenerate the whole skeleton from the upstream worldcup2026
                   repo first (only needed if the schedule itself ever changes),
                   then overlay ESPN results.

Standard library only, so CI needs zero installs. Failures are non-destructive:
if a fetch dies or a match can't be matched, existing scores are left untouched.
"""

import argparse
import json
import os
import sys
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")

# ESPN's undocumented-but-stable public scoreboard for the World Cup.
# A single date-range request returns the whole tournament.
ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates={start}-{end}"
TOURNAMENT_START = datetime(2026, 6, 11, tzinfo=timezone.utc)
TOURNAMENT_END = datetime(2026, 7, 20, tzinfo=timezone.utc)
# ESPN returns an EMPTY payload to unfamiliar User-Agents, so look like a browser.
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

# Each stadium's UTC offset for the Jun–Jul 2026 window (mirrors js/config.js
# venueOffset). Lets us turn our venue-local kick-off times into true UTC so a
# fixture can be matched to ESPN's UTC schedule even across the midnight boundary.
VENUE_OFFSET = {
    "1": -6, "2": -6, "3": -6,                               # Mexico (CST)
    "4": -5, "5": -5, "6": -5,                               # US Central (CDT)
    "7": -4, "8": -4, "9": -4, "10": -4, "11": -4, "12": -4, # US/Canada Eastern (EDT)
    "13": -7, "14": -7, "15": -7, "16": -7,                  # Pacific (PDT)
}

# Map ESPN's stage wording onto our match `type` keys, for filling knockouts.
KO_STAGE = {
    "round of 32": "r32",
    "round of 16": "r16",
    "quarterfinal": "qf",
    "quarter-final": "qf",
    "quarterfinals": "qf",
    "semifinal": "sf",
    "semi-final": "sf",
    "semifinals": "sf",
    "third place": "third",
    "3rd place": "third",
    "final": "final",
}

# --- name matching ----------------------------------------------------------
# Different feeds spell countries differently. We normalise everything
# (lowercase, strip accents + punctuation) and register every variant we might
# see from ESPN / FIFA / common usage. Keys are the normalised form of OUR team
# name; values are alternative spellings that should map to the same team.
# When ESPN throws a name we haven't mapped, it's logged (see UNMATCHED) so it
# can be added here — that's how we keep this working all the way to the final.
SYNONYMS = {
    "unitedstates": ["usa", "usmnt", "unitedstatesofamerica", "us"],
    "southkorea": ["korearepublic", "republicofkorea", "korea", "korearep", "kor", "skorea"],
    "czechrepublic": ["czechia", "czech"],
    "turkey": ["turkiye", "tuerkiye"],
    "ivorycoast": ["cotedivoire", "cotedlvoire", "civ"],
    "capeverde": ["caboverde", "capeverdeislands"],
    "bosniaandherzegovina": ["bosniaherzegovina", "bosniaherzegovina", "bosnia", "bih", "bosniaherz"],
    "democraticrepublicofthecongo": [
        "congodr", "drcongo", "drc", "congokinshasa", "congodemrep",
        "democraticrepubliccongo", "congodemocraticrepublic", "rdcongo", "drcongocongo",
    ],
    "iran": ["iriran", "iranislamicrepublic", "islamicrepublicofiran"],
    "saudiarabia": ["ksa", "saudi"],
    "netherlands": ["holland", "thenetherlands", "ned"],
    "northmacedonia": ["macedonia", "fyrmacedonia"],  # harmless if absent from the draw
    "unitedarabemirates": ["uae"],
    "newzealand": ["nz", "newzealandnz"],
    "southafrica": ["rsa"],
    "england": ["eng"],
    "scotland": ["sco"],
    "wales": ["cymru"],
}


def norm(name):
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return "".join(c for c in s.lower() if c.isalnum())


def build_name_lookup(teams):
    lut = {}
    for t in teams:
        lut[norm(t["name"])] = t["id"]
        # also index the 3-letter FIFA code (ESPN exposes abbreviations too)
        if t.get("code"):
            lut.setdefault(norm(t["code"]), t["id"])
    # attach declared synonyms to whichever of our teams they belong to
    for canon, variants in SYNONYMS.items():
        if canon in lut:
            for v in variants:
                lut.setdefault(norm(v), lut[canon])
    return lut


# names ESPN gave us that we couldn't map — surfaced in the run log so the
# SYNONYMS table above can be extended without guesswork.
UNMATCHED = set()


# --- ESPN fetch -------------------------------------------------------------
def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def espn_results(name_lut):
    """Pull the whole tournament's results from ESPN in one request."""
    url = ESPN.format(
        start=TOURNAMENT_START.strftime("%Y%m%d"),
        end=TOURNAMENT_END.strftime("%Y%m%d"),
    )
    data = fetch_json(url)
    results = []
    for ev in data.get("events", []):
        r = parse_event(ev, name_lut)
        if r:
            results.append(r)
    return results


def parse_event(ev, name_lut):
    try:
        comp = ev["competitions"][0]
        status = (ev.get("status") or comp.get("status") or {}).get("type", {})
        state = status.get("state")  # pre | in | post
        sides = {}
        winner = None  # team id ESPN marks as advancing (covers penalty wins)
        for c in comp.get("competitors", []):
            team = c.get("team", {})
            nm = team.get("displayName") or team.get("name") or "?"
            # try every name field ESPN offers before giving up
            candidates = [
                team.get("displayName"), team.get("name"), team.get("shortDisplayName"),
                team.get("location"), team.get("nickname"), team.get("abbreviation"),
            ]
            tid = next((name_lut[norm(x)] for x in candidates if x and norm(x) in name_lut), None)
            if tid is None:
                UNMATCHED.add(nm)
                return None  # a team we couldn't map — logged for follow-up
            score = c.get("score")
            try:
                score = int(score)
            except (TypeError, ValueError):
                score = 0
            if c.get("winner") is True:
                winner = tid
            sides[c.get("homeAway", "home")] = {"id": tid, "score": score, "name": nm}
        if "home" not in sides or "away" not in sides:
            return None
        # a scheduled fixture ("pre") still tells us the matchup, even with no
        # score yet — we use it to fill knockout slots so the bracket isn't TBD.
        finished = bool(status.get("completed")) or state == "post"
        played = finished or state == "in"
        # try to name the knockout round (for slot-filling)
        stage = None
        for note in comp.get("notes", []) or []:
            head = norm_words(note.get("headline", ""))
            for key, val in KO_STAGE.items():
                if key in head:
                    stage = val
        return {
            "date": (ev.get("date") or "")[:10],  # YYYY-MM-DD (UTC)
            "kickoff": ev.get("date") or "",       # full ISO instant (UTC)
            "home": sides["home"],
            "away": sides["away"],
            "played": played,  # has it kicked off / finished?
            "finished": finished,
            "status": "finished" if finished else (status.get("shortDetail") or "live"),
            "stage": stage,
            "winner": winner,  # advancing team id, or None
        }
    except Exception:
        return None


def norm_words(s):
    return " ".join(unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower().split())


# --- overlay onto our fixtures ----------------------------------------------
def apply_results(matches, results):
    by_id = {m["id"]: m for m in matches}
    # index our group/decided fixtures by the unordered pair of team ids
    pair_index = {}
    for m in matches:
        if m["home_id"] not in ("0", None) and m["away_id"] not in ("0", None):
            pair_index[frozenset((m["home_id"], m["away_id"]))] = m

    updated, ko_pending = 0, []
    for r in results:
        pair = frozenset((r["home"]["id"], r["away"]["id"]))
        m = pair_index.get(pair)
        if m:
            # only played games change anything; a scheduled fixture whose teams
            # we already know needs no action (and writing it would churn commits)
            if r["played"] and set_score(m, r):
                updated += 1
        else:
            ko_pending.append(r)  # a knockout tie our skeleton hasn't filled yet

    # Fill open knockout slots with the real teams. Played ties go first so they
    # claim their slot (and scores); scheduled ties then fill the rest as upcoming
    # matchups — teams only, leaving status/score untouched so they read as TBD-now.
    ko_pending.sort(key=lambda r: (not r["played"], r["date"]))
    for r in ko_pending:
        m = find_open_ko(matches, r)
        if not m:
            continue
        m["home_id"] = r["home"]["id"]
        m["away_id"] = r["away"]["id"]
        if r["played"]:
            set_score(m, r)
        updated += 1  # the slot went from TBD to a real matchup
    return updated


def set_score(m, r):
    # orient ESPN's home/away onto our stored team slots by team identity
    hs = r["home"]["score"]
    as_ = r["away"]["score"]
    mapping = {r["home"]["id"]: hs, r["away"]["id"]: as_}
    new_home = mapping.get(m["home_id"], hs)
    new_away = mapping.get(m["away_id"], as_)
    new_winner = r.get("winner")
    changed = (
        m.get("home_score") != new_home
        or m.get("away_score") != new_away
        or m.get("finished") != r["finished"]
        or m.get("status") != r["status"]
        or (new_winner and m.get("winner_id") != new_winner)
    )
    m["home_score"] = new_home
    m["away_score"] = new_away
    m["finished"] = r["finished"]
    m["status"] = r["status"]
    if new_winner:
        m["winner_id"] = new_winner  # who advanced (resolves penalty ties too)
    return changed


def find_open_ko(matches, r):
    """Pick an as-yet-unfilled knockout fixture matching this result's stage."""
    candidates = [
        m for m in matches
        if m.get("home_id") in ("0", None) and m.get("away_id") in ("0", None)
        and (r["stage"] is None or m.get("type") == r["stage"])
    ]
    if not candidates:
        return None

    # Pick the open slot whose kick-off is closest to ESPN's. Comparing true UTC
    # instants (our venue-local time + VENUE_OFFSET vs ESPN's UTC) means a late
    # evening game that rolls past midnight UTC still lands on the right slot.
    espn = parse_utc(r.get("kickoff"))

    def gap(m):
        slot = slot_utc(m)
        if espn is None or slot is None:
            # fall back to whole-day distance when a timestamp won't parse
            iso = to_iso(m.get("date", ""))
            if not iso or not r.get("date"):
                return 10 ** 9
            try:
                a = datetime.strptime(iso, "%Y-%m-%d")
                b = datetime.strptime(r["date"], "%Y-%m-%d")
                return abs((a - b).days) * 86400
            except Exception:
                return 10 ** 9
        return abs((slot - espn).total_seconds())

    candidates.sort(key=lambda m: (gap(m), m["id"]))
    return candidates[0]


def parse_utc(iso):
    """ESPN ISO instant ('2026-06-30T00:00Z') -> aware UTC datetime, or None."""
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def slot_utc(m):
    """Our 'MM/DD/YYYY HH:MM' venue-local kick-off -> aware UTC datetime, or None."""
    try:
        d, t = (m.get("date", "") + " 00:00").split()[:2]
        mo, da, yr = (int(x) for x in d.split("/"))
        h, mi = (int(x) for x in t.split(":"))
        off = VENUE_OFFSET.get(str(m.get("stadium_id")), 0)
        # local = UTC + off  ->  UTC = local - off
        return datetime(yr, mo, da, h, mi, tzinfo=timezone.utc) - timedelta(hours=off)
    except Exception:
        return None


def to_iso(local_date):
    # "MM/DD/YYYY HH:MM" -> "YYYY-MM-DD"
    try:
        d = local_date.split(" ")[0]
        mo, da, yr = d.split("/")
        return f"{yr}-{int(mo):02d}-{int(da):02d}"
    except Exception:
        return ""


# --- skeleton rebuild (only with --rebuild) ---------------------------------
UPSTREAM = "https://raw.githubusercontent.com/rezarahiminia/worldcup2026/main/"
SKEL_FILES = {
    "teams": "football.teams.json",
    "matches": "football.matches.json",
    "stadiums": "football.stadiums.json",
    "tables": "football.matchtables.json",
}
ALIAS = {
    "DR Congo": "Democratic Republic of the Congo",
    "USA": "United States",
    "Curacao": "Curaçao",
    "Bosnia": "Bosnia and Herzegovina",
}
DRAW = [
    ("Justin W", ["Netherlands", "Japan", "Cape Verde"]),
    ("Ben L", ["Brazil", "Ecuador", "New Zealand"]),
    ("Shane C", ["Belgium", "Ivory Coast", "Jordan"]),
    ("Brendon J", ["Uruguay", "Sweden", "DR Congo"]),
    ("Eric L", ["USA", "Qatar", "Norway"]),
    ("Sam F", ["Mexico", "Austria", "Saudi Arabia"]),
    ("Aaron T", ["Spain", "Switzerland", "Curacao"]),
    ("Ashton D", ["Germany", "Iran", "Ghana"]),
    ("David W", ["Colombia", "Australia", "Panama"]),
    ("Shane F", ["Croatia", "Canada", "Paraguay"]),
    ("Michael W", ["England", "South Korea", "Scotland"]),
    ("Garry S", ["Senegal", "Egypt", "Iraq"]),
    ("Rick M", ["Morocco", "Algeria", "Uzbekistan"]),
    ("Casey M", ["Argentina", "Tunisia", "South Africa"]),
    ("Tim C", ["France", "Turkey", "Bosnia"]),
    ("Luke K", ["Portugal", "Czech Republic", "Haiti"]),
]


def to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def rebuild_skeleton():
    raw = {k: fetch_json(UPSTREAM + f) for k, f in SKEL_FILES.items()}
    teams = sorted(
        ({"id": t["id"], "name": t["name_en"], "name_fa": t.get("name_fa", ""),
          "code": t.get("fifa_code", ""), "iso2": (t.get("iso2") or "").lower(),
          "flag": t.get("flag", ""), "group": t.get("groups", "")} for t in raw["teams"]),
        key=lambda x: int(x["id"]),
    )
    matches = sorted(
        ({"id": int(m["id"]), "home_id": m["home_team_id"], "away_id": m["away_team_id"],
          "home_score": to_int(m["home_score"]), "away_score": to_int(m["away_score"]),
          "home_scorers": None, "away_scorers": None, "group": m.get("group", ""),
          "matchday": m.get("matchday", ""), "date": m.get("local_date", ""),
          "stadium_id": m.get("stadium_id", ""),
          "finished": str(m.get("finished", "FALSE")).upper() == "TRUE",
          "status": m.get("time_elapsed", "notstarted"), "type": m.get("type", "group")} for m in raw["matches"]),
        key=lambda x: x["id"],
    )
    stadiums = [{"id": s["id"], "name": s.get("name_en", ""), "fifa_name": s.get("fifa_name", ""),
                 "city": s.get("city_en", ""), "country": s.get("country_en", ""),
                 "capacity": s.get("capacity"), "region": s.get("region", "")} for s in raw["stadiums"]]
    tables = [{"group": t["group"], "teams": t["teams"]} for t in raw["tables"]]
    name_to_id = {t["name"]: t["id"] for t in teams}
    owners = []
    for i, (owner, picks) in enumerate(DRAW):
        ids = [name_to_id[ALIAS.get(p, p)] for p in picks]
        owners.append({"id": f"o{i + 1}", "name": owner, "team_ids": ids})
    write("teams.json", teams)
    write("stadiums.json", stadiums)
    write("grouptables.json", tables)
    write("owners.json", owners)
    write("matches.json", matches)
    return matches


# --- io ---------------------------------------------------------------------
def load(name):
    with open(os.path.join(DATA_DIR, name), encoding="utf-8") as f:
        return json.load(f)


def write(name, obj):
    with open(os.path.join(DATA_DIR, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true", help="regenerate the fixture skeleton first")
    args = ap.parse_args()

    if args.rebuild:
        print("Rebuilding skeleton from upstream worldcup2026 repo…")
        try:
            matches = rebuild_skeleton()
        except Exception as e:
            print(f"Rebuild failed, leaving data untouched: {e}", file=sys.stderr)
            return 1
    else:
        matches = load("matches.json")

    teams = load("teams.json")
    name_lut = build_name_lookup(teams)

    print("Fetching live results from ESPN…")
    try:
        results = espn_results(name_lut)
    except Exception as e:
        print(f"ESPN fetch failed, keeping existing scores: {e}", file=sys.stderr)
        return 1

    updated = apply_results(matches, results)
    write("matches.json", matches)

    played = sum(1 for m in matches if m["finished"])
    write("meta.json", {
        "source": "espn fifa.world + worldcup2026 fixtures",
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "matches": len(matches),
        "finished": played,
    })
    print(f"ESPN events parsed: {len(results)} · fixtures updated: {updated} · finished so far: {played}/{len(matches)}")
    if UNMATCHED:
        print("  ⚠ unmatched team names (add to SYNONYMS): " + ", ".join(sorted(UNMATCHED)), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
