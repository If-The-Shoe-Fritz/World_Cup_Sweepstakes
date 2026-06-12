#!/usr/bin/env python3
"""
Refresh the bundled /data files from the upstream worldcup2026 repo.

Pulls the latest teams + match data, normalises it into the shape the website
expects, and (re)builds the owner -> team mapping from the sweepstakes draw.
Runs on nothing but the Python standard library so CI needs zero installs.

Usage:  python scripts/update_data.py
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

UPSTREAM = "https://raw.githubusercontent.com/rezarahiminia/worldcup2026/main/"
FILES = {
    "teams": "football.teams.json",
    "matches": "football.matches.json",
    "stadiums": "football.stadiums.json",
    "tables": "football.matchtables.json",
}

# The sweepstakes draw. A handful of names differ between our spreadsheet and
# the API's official names — map them here.
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")


def fetch(name):
    url = UPSTREAM + FILES[name]
    req = urllib.request.Request(url, headers={"User-Agent": "wc26-sweepstakes"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def build_teams(raw):
    teams = [
        {
            "id": t["id"],
            "name": t["name_en"],
            "name_fa": t.get("name_fa", ""),
            "code": t.get("fifa_code", ""),
            "iso2": (t.get("iso2") or "").lower(),
            "flag": t.get("flag", ""),
            "group": t.get("groups", ""),
        }
        for t in raw
    ]
    teams.sort(key=lambda x: int(x["id"]))
    return teams


def build_matches(raw):
    matches = []
    for m in raw:
        matches.append(
            {
                "id": int(m["id"]),
                "home_id": m["home_team_id"],
                "away_id": m["away_team_id"],
                "home_score": to_int(m["home_score"]),
                "away_score": to_int(m["away_score"]),
                "home_scorers": None if str(m.get("home_scorers")).lower() == "null" else m.get("home_scorers"),
                "away_scorers": None if str(m.get("away_scorers")).lower() == "null" else m.get("away_scorers"),
                "group": m.get("group", ""),
                "matchday": m.get("matchday", ""),
                "date": m.get("local_date", ""),
                "stadium_id": m.get("stadium_id", ""),
                "finished": str(m.get("finished", "FALSE")).upper() == "TRUE",
                "status": m.get("time_elapsed", "notstarted"),
                "type": m.get("type", "group"),
            }
        )
    matches.sort(key=lambda x: x["id"])
    return matches


def build_stadiums(raw):
    return [
        {
            "id": s["id"],
            "name": s.get("name_en", ""),
            "fifa_name": s.get("fifa_name", ""),
            "city": s.get("city_en", ""),
            "country": s.get("country_en", ""),
            "capacity": s.get("capacity"),
            "region": s.get("region", ""),
        }
        for s in raw
    ]


def build_tables(raw):
    return [{"group": t["group"], "teams": t["teams"]} for t in raw]


def build_owners(teams):
    name_to_id = {t["name"]: t["id"] for t in teams}
    owners = []
    for i, (owner, picks) in enumerate(DRAW):
        ids = []
        for p in picks:
            canon = ALIAS.get(p, p)
            if canon not in name_to_id:
                raise SystemExit(f"ERROR: team '{p}' ({canon}) not found in upstream teams")
            ids.append(name_to_id[canon])
        owners.append({"id": f"o{i + 1}", "name": owner, "team_ids": ids})
    return owners


def write(name, obj):
    path = os.path.join(DATA_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        raw = {k: fetch(k) for k in FILES}
    except Exception as e:  # don't clobber good data on a network hiccup
        print(f"Fetch failed, leaving existing data untouched: {e}", file=sys.stderr)
        return 1

    teams = build_teams(raw["teams"])
    matches = build_matches(raw["matches"])
    stadiums = build_stadiums(raw["stadiums"])
    tables = build_tables(raw["tables"])
    owners = build_owners(teams)

    write("teams.json", teams)
    write("matches.json", matches)
    write("stadiums.json", stadiums)
    write("grouptables.json", tables)
    write("owners.json", owners)
    write(
        "meta.json",
        {
            "source": "rezarahiminia/worldcup2026",
            "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "matches": len(matches),
            "teams": len(teams),
        },
    )

    played = sum(1 for m in matches if m["finished"])
    print(f"Updated: {len(teams)} teams, {len(matches)} matches ({played} finished), {len(owners)} owners")
    return 0


if __name__ == "__main__":
    sys.exit(main())
