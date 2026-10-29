"""What does Garmin actually hold for THIS account and watch?

    source venv/bin/activate
    python survey.py                 # yesterday
    python survey.py 2026-08-15

garminconnect exposes 105 endpoints. Most will be empty for any given person —
no scale, no chest strap, no cycling power meter, nutrition never used. Before
designing storage for "every last drop", this establishes which drops exist,
how big each one is, and what it contains.

Prints a table of: endpoint, status, payload size, and the top-level keys. Use
it to decide what is worth capturing daily, what is worth capturing weekly, and
what is dead weight.

Reads garmin_session.txt if present, otherwise signs in interactively.
Writes nothing to the database and never modifies your Garmin account.
"""

from __future__ import annotations

import base64
import getpass
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from garminconnect import Garmin

PAUSE = 0.35

# Everything that takes a single calendar date.
PER_DAY = [
    "get_user_summary", "get_sleep_data", "get_hrv_data", "get_stats",
    "get_stats_and_body", "get_rhr_day", "get_all_day_stress", "get_stress_data",
    "get_body_battery_events", "get_heart_rates", "get_respiration_data",
    "get_spo2_data", "get_steps_data", "get_floors", "get_intensity_minutes_data",
    "get_max_metrics", "get_training_readiness", "get_morning_training_readiness",
    "get_training_status", "get_fitnessage_data", "get_hydration_data",
    "get_daily_weigh_ins", "get_all_day_events", "get_lifestyle_logging_data",
    "get_nutrition_daily_food_log",
]

# Range endpoints, called with a short window.
RANGED = [
    "get_body_battery", "get_daily_steps", "get_rhr_daily", "get_sleep_daily",
    "get_hrv_data_range", "get_max_metrics_range", "get_endurance_score",
    "get_hill_score", "get_race_predictions", "get_body_composition",
    "get_weigh_ins", "get_calories_daily", "get_weekly_intensity_minutes",
]


def client() -> Garmin:
    blob = Path("garmin_session.txt")
    if blob.exists():
        c = Garmin()
        c.login(tokenstore=base64.b64decode(blob.read_text()).decode("utf-8"))
        return c
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password (not stored): ")
    c = Garmin(email=email, password=password, prompt_mfa=lambda: input("MFA code: ").strip())
    c.login()
    return c


def describe(v) -> tuple[int, str]:
    """Size in bytes and a short shape description."""
    try:
        blob = json.dumps(v, default=str)
    except Exception:
        return 0, "unserialisable"
    n = len(blob)
    if v is None:
        return n, "null"
    if isinstance(v, list):
        if not v:
            return n, "empty list"
        inner = v[0]
        keys = ", ".join(list(inner)[:6]) if isinstance(inner, dict) else type(inner).__name__
        return n, f"list[{len(v)}] of {{{keys}}}"
    if isinstance(v, dict):
        if not v:
            return n, "empty dict"
        return n, ", ".join(list(v)[:8])
    return n, type(v).__name__


def main() -> int:
    day = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else date.today() - timedelta(days=1)
    ds = day.isoformat()
    start = (day - timedelta(days=6)).isoformat()

    c = client()
    print(f"\nSurveying {ds} for {c.get_full_name()}\n")

    rows: list[tuple[str, str, int, str]] = []

    for name in PER_DAY:
        fn = getattr(c, name, None)
        if fn is None:
            rows.append((name, "ABSENT", 0, "not in this garminconnect version"))
            continue
        try:
            v = fn(ds)
            n, shape = describe(v)
            rows.append((name, "ok" if n > 20 else "EMPTY", n, shape))
        except Exception as e:
            rows.append((name, "FAIL", 0, str(e)[:70]))
        time.sleep(PAUSE)

    for name in RANGED:
        fn = getattr(c, name, None)
        if fn is None:
            rows.append((name, "ABSENT", 0, "not in this garminconnect version"))
            continue
        try:
            v = fn(start, ds)
            n, shape = describe(v)
            rows.append((name + " (7d)", "ok" if n > 20 else "EMPTY", n, shape))
        except Exception as e:
            rows.append((name + " (7d)", "FAIL", 0, str(e)[:70]))
        time.sleep(PAUSE)

    # One activity, in full — we currently keep six fields out of however many.
    try:
        acts = c.get_activities(0, 1)
        if acts:
            n, shape = describe(acts[0])
            rows.append(("activity (full record)", "ok", n, shape))
            aid = acts[0].get("activityId")
            if aid:
                for nm, fn in [
                    ("activity_details", lambda: c.get_activity_details(aid)),
                    ("activity_splits", lambda: c.get_activity_splits(aid)),
                    ("activity_hr_zones", lambda: c.get_activity_hr_in_timezones(aid)),
                ]:
                    try:
                        n2, s2 = describe(fn())
                        rows.append((nm, "ok" if n2 > 20 else "EMPTY", n2, s2))
                    except Exception as e:
                        rows.append((nm, "FAIL", 0, str(e)[:70]))
                    time.sleep(PAUSE)
    except Exception as e:
        rows.append(("activities", "FAIL", 0, str(e)[:70]))

    width = max(len(r[0]) for r in rows) + 1
    print(f"{'ENDPOINT'.ljust(width)} {'STATUS':7} {'BYTES':>8}  CONTENT")
    print("-" * (width + 100))
    for name, status, n, shape in sorted(rows, key=lambda r: (-r[2], r[0])):
        print(f"{name.ljust(width)} {status:7} {n:>8}  {shape[:95]}")

    live = [r for r in rows if r[1] == "ok"]
    print(f"\n{len(live)} of {len(rows)} endpoints returned data.")
    print(f"Roughly {sum(r[2] for r in live) / 1024:.0f} KB per day if everything were stored verbatim.")
    print(f"Over two years that is about {sum(r[2] for r in live) * 730 / 1_048_576:.0f} MB.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
