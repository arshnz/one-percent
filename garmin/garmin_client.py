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

import json
import logging
import time
from datetime import date, datetime, timedelta, timezone
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


def _local_minutes(ms: Any) -> int | None:
    """Garmin's *TimestampLocal fields are epoch millis pre-shifted so that
    reading them as UTC gives local wall-clock time. Converting to minutes
    since midnight keeps that intent and drops every timezone question — and
    minutes-of-day is exactly what the circular statistics want anyway."""
    if not isinstance(ms, (int, float)) or isinstance(ms, bool):
        return None
    try:
        t = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None
    return t.hour * 60 + t.minute


def _slim(d: dict) -> dict:
    """Keep the raw payload to scalars. It is a safety net for fields we have
    not modelled yet — the cost of NOT keeping it is a backfill that can never
    be redone — but Garmin also nests whole event arrays in there, and those
    would bloat every row for no benefit."""
    return {k: v for k, v in d.items() if isinstance(v, (int, float, str, bool))}


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
    raw: dict[str, Any] = {}

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
            "sedentarySeconds": _int(s.get("sedentarySeconds")),
            "bodyBatteryAtWake": _int(s.get("bodyBatteryAtWakeTime")),
            "lowStressSeconds": _int(s.get("lowStressDuration")),
            "highStressSeconds": _int(s.get("highStressDuration")),
            "minHeartRate": _int(s.get("minHeartRate")),
            "maxHeartRate": _int(s.get("maxHeartRate")),
            "avgWakingRespiration": _float(s.get("avgWakingRespirationValue")),
        }))
        raw["summary"] = _slim(s)
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
            # When you actually went to sleep and woke — the fields that make
            # sleep REGULARITY measurable. Garmin records them and scores
            # neither.
            "sleepStartMin": _local_minutes(dto.get("sleepStartTimestampLocal")),
            "sleepEndMin": _local_minutes(dto.get("sleepEndTimestampLocal")),
            "avgSleepStress": _float(dto.get("avgSleepStress")),
            "awakeCount": _int(dto.get("awakeCount")),
            # Some firmware reports overnight HRV here; the dedicated endpoint
            # below is preferred and overwrites this when it has a value.
            "hrvNight": _int(dto.get("avgOvernightHrv")),
        }))
        raw["sleep"] = _slim(dto)
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
    if raw:
        out["raw"] = raw
    return out


# Every per-day endpoint worth calling, after removing the duplicates the
# survey exposed:
#   get_stats == get_user_summary == the summary half of get_stats_and_body,
#   get_all_day_stress == get_stress_data,
#   get_max_metrics == get_max_metrics_range,
#   get_daily_weigh_ins == get_body_composition.
# Keeping one of each saves roughly 40 KB and four requests per day for nothing.
#
# (domain, method). Order is roughly most- to least-valuable so that a run cut
# short by a timeout still got the important ones.
RAW_DOMAINS: list[tuple[str, str]] = [
    ("statsAndBody", "get_stats_and_body"),
    ("sleep", "get_sleep_data"),
    ("hrv", "get_hrv_data"),
    ("trainingReadiness", "get_training_readiness"),
    ("morningReadiness", "get_morning_training_readiness"),
    ("trainingStatus", "get_training_status"),
    ("maxMetrics", "get_max_metrics"),
    ("stress", "get_all_day_stress"),
    ("bodyBatteryEvents", "get_body_battery_events"),
    ("hr", "get_heart_rates"),
    ("respiration", "get_respiration_data"),
    ("steps", "get_steps_data"),
    ("spo2", "get_spo2_data"),
    ("floors", "get_floors"),
    ("intensityMinutes", "get_intensity_minutes_data"),
    ("fitnessAge", "get_fitnessage_data"),
    ("rhrDay", "get_rhr_day"),
    ("hydration", "get_hydration_data"),
    ("allDayEvents", "get_all_day_events"),
    ("lifestyle", "get_lifestyle_logging_data"),
    ("bodyComposition", "get_daily_weigh_ins"),
    ("nutrition", "get_nutrition_daily_food_log"),
]

# Anything under this is Garmin's way of saying "nothing here" — an empty dict,
# an empty list, a null. Not worth a row.
MIN_PAYLOAD_CHARS = 20


def fetch_raw_day(client, day: date) -> list[dict]:
    """Every endpoint for one day, verbatim.

    Each call is isolated: an endpoint that starts failing costs its own domain
    and nothing else. That matters more here than anywhere — this is the
    capture layer, and a single bad endpoint must never cost a day of the other
    twenty.
    """
    ds = day.isoformat()
    out: list[dict] = []
    for domain, method in RAW_DOMAINS:
        fn = getattr(client, method, None)
        if fn is None:
            continue
        try:
            payload = fn(ds)
        except Exception as e:  # noqa: BLE001
            log.warning("raw %s failed for %s: %s", domain, ds, e)
            time.sleep(REQUEST_PAUSE_SEC)
            continue
        if payload is None:
            time.sleep(REQUEST_PAUSE_SEC)
            continue
        try:
            if len(json.dumps(payload, default=str)) < MIN_PAYLOAD_CHARS:
                time.sleep(REQUEST_PAUSE_SEC)
                continue
        except (TypeError, ValueError):
            time.sleep(REQUEST_PAUSE_SEC)
            continue
        out.append({"date": ds, "domain": domain, "payload": payload})
        time.sleep(REQUEST_PAUSE_SEC)
    return out


def fetch_activity_raw(client, external_id: str, summary: dict) -> list[dict]:
    """The full record for one activity, plus its detail streams.

    `details` is by far the largest single payload Garmin returns (~300 KB —
    the per-second sensor streams). It is also the only place the shape of a
    session lives, so it is exactly the thing that would be painful to discover
    we had thrown away.
    """
    out = [{"externalId": external_id, "domain": "summary", "payload": summary}]
    for domain, method in [
        ("details", "get_activity_details"),
        ("splits", "get_activity_splits"),
        ("hrZones", "get_activity_hr_in_timezones"),
    ]:
        fn = getattr(client, method, None)
        if fn is None:
            continue
        try:
            payload = fn(external_id)
            if payload is not None:
                out.append({"externalId": external_id, "domain": domain, "payload": payload})
        except Exception as e:  # noqa: BLE001
            log.warning("activity %s %s failed: %s", external_id, domain, e)
        time.sleep(REQUEST_PAUSE_SEC)
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
