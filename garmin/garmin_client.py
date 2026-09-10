"""Talking to Garmin Connect, and turning what comes back into our shape.

Uses `garminconnect`, not `garth`. Garmin's March 2026 TLS fingerprinting and
Cloudflare killed garth's mobile sign-in and it is deprecated upstream;
garminconnect answered the same event by moving to `curl_cffi`, which presents a
real browser fingerprint, and it layers several auth strategies with fallback —
in practice the mobile endpoints can return 429 while a later strategy still
gets through.

Still unofficial, so everything here is defensive: each metric group is fetched
in its own try/except, so one endpoint changing shape costs that metric rather
than the whole sync, and every field is read with .get() because Garmin omits
keys on days it has nothing for rather than sending nulls.

Nothing here computes a local date. The server owns that (see
server/src/routes/wearable.ts) so there is exactly one timezone authority.
"""

from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from typing import Any

log = logging.getLogger("garmin")

# Gentler than the Connect web app's own request rate.
REQUEST_PAUSE_SEC = 0.4


def _secs_to_mins(v: Any) -> int | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return round(v / 60)


def _int(v: Any) -> int | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return round(v)


def _float(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return round(float(v), 1)


def _prune(d: dict) -> dict:
    """Drop keys with no value. The server treats absent as 'no data this sync'
    and leaves whatever it already had alone, which is what we want."""
    return {k: v for k, v in d.items() if v is not None}


def fetch_day(client, day: date) -> dict:
    """One day as a WearableDay payload.

    Always returns a payload, even a bare {"date": …} — see the note at the end
    about marking days Garmin genuinely has nothing for."""
    ds = day.isoformat()
    out: dict[str, Any] = {"date": ds}

    # --- daily summary: steps, resting HR, Body Battery, stress -----------
    try:
        s = client.get_user_summary(ds) or {}
        mod = s.get("moderateIntensityMinutes") or 0
        vig = s.get("vigorousIntensityMinutes") or 0
        out.update(_prune({
            "steps": _int(s.get("totalSteps")),
            "restingHr": _int(s.get("restingHeartRate")),
            "bodyBatteryHigh": _int(s.get("bodyBatteryHighestValue")),
            "bodyBatteryLow": _int(s.get("bodyBatteryLowestValue")),
            "stressAvg": _int(s.get("averageStressLevel")),
            "activeMinutes": _int(mod + vig) if (mod or vig) else None,
        }))
    except Exception as e:  # noqa: BLE001 — one bad endpoint must not stop the rest
        log.warning("daily summary failed for %s: %s", ds, e)

    time.sleep(REQUEST_PAUSE_SEC)

    # --- sleep: stages, score, respiration --------------------------------
    try:
        sleep = client.get_sleep_data(ds) or {}
        dto = sleep.get("dailySleepDTO") or {}
        scores = dto.get("sleepScores") or {}
        overall = scores.get("overall") or {}
        out.update(_prune({
            "sleepMinutes": _secs_to_mins(dto.get("sleepTimeSeconds")),
            "deepMinutes": _secs_to_mins(dto.get("deepSleepSeconds")),
            "remMinutes": _secs_to_mins(dto.get("remSleepSeconds")),
            "sleepScore": _int(overall.get("value")),
            "respirationAvg": _float(dto.get("averageRespirationValue")),
            # Some firmware reports overnight HRV here; the dedicated endpoint
            # below is preferred and overwrites this when it has a value.
            "hrvNight": _int(dto.get("avgOvernightHrv")),
        }))
    except Exception as e:  # noqa: BLE001
        log.warning("sleep failed for %s: %s", ds, e)

    time.sleep(REQUEST_PAUSE_SEC)

    # --- overnight HRV -----------------------------------------------------
    try:
        hrv = client.get_hrv_data(ds) or {}
        summary = hrv.get("hrvSummary") or {}
        avg = _int(summary.get("lastNightAvg"))
        if avg is not None:
            out["hrvNight"] = avg
    except Exception as e:  # noqa: BLE001
        log.warning("hrv failed for %s: %s", ds, e)

    # Even a day with no metrics is returned. Garmin genuinely has nothing for
    # some days — watch on the charger, or before you owned it — and without a
    # row to mark the attempt, the gap filler would request those same days on
    # every run for the rest of time. The server stores a metric-less row; the
    # charts already treat null fields as gaps, so it renders identically.
    return out


def fetch_activities(client, limit: int = 30) -> list[dict]:
    """Recent activities. Nothing in v1 reads these — they are captured because
    `startedAt` is the one thing a later backfill cannot reconstruct."""
    try:
        items = client.get_activities(0, limit) or []
    except Exception as e:  # noqa: BLE001
        log.warning("activities failed: %s", e)
        return []

    out = []
    for a in items:
        if not isinstance(a, dict):
            continue
        started = a.get("startTimeGMT")
        act_id = a.get("activityId")
        if not started or act_id is None:
            continue
        # Garmin sends "2026-09-10 06:12:34" in GMT with no zone marker.
        iso = str(started).replace(" ", "T")
        if not iso.endswith("Z"):
            iso += "Z"
        out.append(_prune({
            "externalId": str(act_id),
            "type": ((a.get("activityType") or {}).get("typeKey") or "unknown"),
            "startedAt": iso,
            "durationSec": _int(a.get("duration")) or 0,
            "distanceM": _float(a.get("distance")),
            "avgHr": _int(a.get("averageHR")),
        }))
    return out


def days_to_sync(
    today: date,
    held: set[str],
    recent_days: int,
    backfill_batch: int,
    backfill_floor: date,
) -> list[date]:
    """Which days to ask for on this run.

    Two jobs:

      * Always re-fetch a recent window. Garmin revises last night's sleep and
        Body Battery for a day or two afterwards, so the newest days are never
        treated as settled.
      * Fill gaps NEWEST FIRST, wherever they are. Two earlier mistakes here:
        walking backwards from the oldest day held assumed the history was
        contiguous, so a failed run or a deleted row left a hole nothing ever
        returned to; and filling oldest-first meant spending days on 2024
        history while a visible hole in the last few months stayed visible.
        Recent history is what gets looked at, so it is what gets closed first.

    Bounded per run either way, so a two-year backfill is spread over a handful
    of scheduled runs rather than one request storm Garmin would throttle.
    """
    recent = [today - timedelta(days=i) for i in range(recent_days)]

    missing: list[date] = []
    cursor = today - timedelta(days=recent_days)
    while cursor >= backfill_floor and len(missing) < backfill_batch:
        if cursor.isoformat() not in held:
            missing.append(cursor)
        cursor -= timedelta(days=1)

    return sorted(set(recent + missing))
