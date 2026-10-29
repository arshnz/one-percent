"""The Garmin collector — a second Firebase Functions codebase.

Separate from the `api` codebase on purpose: it is Python (garminconnect has
no Node equivalent that survives Garmin's anti-bot), and it deploys on its own
with

    firebase deploy --only functions:garmin

so it can never prune the `api` function. See the warning in
server/src/functions.ts about exactly that.

It writes nothing to Postgres. It normalises what Garmin gives it and POSTs to
/api/wearable/ingest, which is the single writer — see the comment at the top
of server/src/routes/wearable.ts for why.

Follows the house rule for optional integrations (cf. launcherSnapshot.ts): if
GARMIN_SESSION is unset it no-ops cleanly rather than failing a deploy.
"""

from __future__ import annotations

import base64
import logging
import os
import time
from datetime import date, datetime, timedelta

import requests
from garminconnect import Garmin
from firebase_functions import scheduler_fn, https_fn
from firebase_functions.params import SecretParam

from garmin_client import (
    days_to_sync, fetch_activities, fetch_activity_raw, fetch_day, fetch_raw_day,
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("garmin")

GARMIN_SESSION = SecretParam("GARMIN_SESSION")
WEARABLE_INGEST_SECRET = SecretParam("WEARABLE_INGEST_SECRET")
API_BASE = SecretParam("WEARABLE_API_BASE")

OWNER_EMAIL = os.environ.get("GARMIN_OWNER_EMAIL", "arshdeep.m@gmail.com")

# Garmin keeps revising a night's sleep and Body Battery for a day or two, so
# the recent window is always re-fetched rather than assumed final.
RECENT_DAYS = 10
# One bounded bite of history per run — see days_to_sync().
BACKFILL_BATCH = 45
# How far back to bother going at all.
BACKFILL_YEARS = 2

# Verbatim capture is ~22 requests per day against 3 for the curated fields, so
# it gets its own budget and its own cursor. A wall-clock budget rather than a
# day count: endpoint latency varies enough that "20 days" can mean 90 seconds
# or 400, and overrunning the function timeout loses the whole run's writes.
RAW_BUDGET_SEC = 240
# Newest activities whose full record (including the ~300 KB detail stream) to
# pull each run.
ACTIVITY_RAW_PER_RUN = 4

SECRETS = [GARMIN_SESSION, WEARABLE_INGEST_SECRET, API_BASE]


def _post(path: str, payload: dict) -> dict:
    r = requests.post(
        f"{API_BASE.value.rstrip('/')}{path}",
        json=payload,
        headers={"x-ingest-secret": WEARABLE_INGEST_SECRET.value},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def _report_error(message: str) -> None:
    """Record the failure against the sync row so the app can say so, instead
    of showing a stale 'last synced' and looking healthy while it is broken."""
    try:
        _post("/api/wearable/ingest", {"email": OWNER_EMAIL, "error": message[:500]})
    except Exception as e:  # noqa: BLE001
        log.error("could not even report the error: %s", e)


def _resume_session() -> Garmin:
    """Restore the saved Garmin session.

    Deliberately no password anywhere. `login_local.py` does the interactive
    sign-in once (handling MFA), and only the resulting OAuth tokens live in
    Secret Manager. They refresh themselves; when the long-lived one finally
    expires the sync reports an error and the app asks for one more local login.

    The secret holds garminconnect's own inline-JSON session, which `login()`
    takes directly — no token files, no temp directory. (Writing one would fail
    anyway: token_file_path() rejects symlinked paths, which is most temp dirs.)
    """
    blob = GARMIN_SESSION.value
    if not blob:
        raise RuntimeError("GARMIN_SESSION is not set")

    session_json = base64.b64decode(blob).decode("utf-8")

    # More patient than the default (3 attempts, 10s cap). Garmin rate-limits
    # by IP and a cloud egress address is shared with a lot of other traffic;
    # this runs unattended every six hours, so waiting is free and failing is
    # not. 0.3.13 exposes these — see garminconnect's Garmin.__init__.
    client = Garmin(retry_attempts=5, retry_min_wait=2.0, retry_max_wait=30.0)
    client.login(tokenstore=session_json)
    return client


def run_sync(force_days: int = 0, force_offset: int = 0) -> str:
    if not GARMIN_SESSION.value:
        return "skipped: GARMIN_SESSION unset"

    try:
        client = _resume_session()
    except Exception as e:  # noqa: BLE001
        msg = f"Garmin sign-in failed — reconnect needed ({e})"
        log.error(msg)
        _report_error(msg)
        return msg

    # Where to resume from, and in whose timezone "today" is.
    state = requests.get(
        f"{API_BASE.value.rstrip('/')}/api/wearable/ingest/state",
        params={"email": OWNER_EMAIL, "window": 365 * BACKFILL_YEARS},
        headers={"x-ingest-secret": WEARABLE_INGEST_SECRET.value},
        timeout=30,
    )
    state.raise_for_status()
    st = state.json()
    held = set(st.get("held") or [])

    today = datetime.now().date()
    floor = today - timedelta(days=365 * BACKFILL_YEARS)

    if force_days:
        # Re-fetch days we already hold. Needed when a new field is added to
        # the payload: the gap filler skips anything already stored, so without
        # this a new column stays null on every historical day forever.
        # Offset lets a long backfill be walked in chunks that each finish
        # inside the function timeout.
        wanted = [
            today - timedelta(days=force_offset + i)
            for i in range(force_days)
            if (today - timedelta(days=force_offset + i)) >= floor
        ]
    else:
        wanted = days_to_sync(today, held, RECENT_DAYS, BACKFILL_BATCH, floor)

    days = []
    for d in wanted:
        row = fetch_day(client, d)
        if row:
            days.append(row)

    activities = fetch_activities(client, limit=30)

    # ── Verbatim capture ────────────────────────────────────────────────────
    # Flushed to the server as it goes, NOT accumulated and posted at the end.
    # The first version buffered everything: the run hit the 540s function
    # timeout mid-fetch and every byte of six minutes' work was discarded,
    # because nothing had been written yet. Streaming means a timeout costs
    # the current day and nothing before it.
    raw_held = set(st.get("rawHeld") or [])
    activity_held = set(st.get("activityRawHeld") or [])
    started = time.monotonic()
    raw_sent = 0
    raw_days = 0

    def flush(payload_key: str, items: list) -> int:
        if not items:
            return 0
        try:
            res = _post("/api/wearable/ingest", {
                "email": OWNER_EMAIL, "source": "garmin", payload_key: items,
            })
            return res.get("raws", 0)
        except Exception as e:  # noqa: BLE001
            log.warning("raw flush failed (%d items): %s", len(items), e)
            return 0

    pending: list[dict] = []
    cursor = today
    while cursor >= floor and (time.monotonic() - started) < RAW_BUDGET_SEC:
        if cursor.isoformat() not in raw_held:
            pending.extend(fetch_raw_day(client, cursor))
            raw_days += 1
            # A day is ~250 KB across ~20 rows; flush every couple of days so
            # each request stays well inside the server's body limit.
            if len(pending) >= 40:
                raw_sent += flush("raws", pending)
                pending = []
        cursor -= timedelta(days=1)
    raw_sent += flush("raws", pending)

    # Full activity records. The detail stream alone is ~300 KB, so these go
    # one at a time.
    for a in activities:
        if (time.monotonic() - started) > RAW_BUDGET_SEC + 120:
            break
        if a["externalId"] in activity_held:
            continue
        raw_sent += flush("activityRaws", fetch_activity_raw(client, a["externalId"], a))

    if not days and not activities:
        return f"ok: raw only — {raw_sent} payload(s) over {raw_days} day(s)"

    # Chunked so one request never carries more than the server's own cap.
    sent = 0
    for i in range(0, max(len(days), 1), 200):
        res = _post("/api/wearable/ingest", {
            "email": OWNER_EMAIL,
            "source": "garmin",
            "days": days[i:i + 200],
            "activities": activities if i == 0 else [],
        })
        sent += res.get("days", 0)

    return (
        f"ok: {sent} curated day(s), {len(activities)} activities, "
        f"raw {raw_sent} payload(s) over {raw_days} day(s); "
        f"{len(held)} days held, {len(raw_held)} raw-complete"
    )


@scheduler_fn.on_schedule(
    schedule="every 6 hours",
    region="us-central1",
    memory=512,
    timeout_sec=540,
    secrets=SECRETS,
)
def garminsync(_event: scheduler_fn.ScheduledEvent) -> None:
    try:
        log.info("[garminsync] %s", run_sync())
    except Exception as e:  # noqa: BLE001
        log.exception("[garminsync] failed")
        _report_error(str(e))


@https_fn.on_request(region="us-central1", memory=512, timeout_sec=540, secrets=SECRETS)
def garminsyncnow(req: https_fn.Request) -> https_fn.Response:
    """Manual trigger, same shared secret as the ingest endpoint. Lets the
    Settings page offer a 'sync now' without waiting six hours, and makes the
    first backfill something you can drive rather than wait out."""
    if req.headers.get("x-ingest-secret") != WEARABLE_INGEST_SECRET.value:
        return https_fn.Response("unauthorised", status=401)
    try:
        # ?force=60&offset=0 re-fetches days already held, oldest-bounded.
        force = min(int(req.args.get("force", 0) or 0), 120)
        offset = max(int(req.args.get("offset", 0) or 0), 0)
        return https_fn.Response(run_sync(force, offset), status=200)
    except Exception as e:  # noqa: BLE001
        log.exception("[garminsyncnow] failed")
        _report_error(str(e))
        return https_fn.Response(f"error: {e}", status=500)
