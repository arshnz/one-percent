"""Check that the field mapping in garmin_client.py matches what Garmin
actually returns, for one day, without writing anything to the database.

    source venv/bin/activate
    python probe.py            # yesterday
    python probe.py 2026-09-05

The field names in garmin_client.py are the ones Garmin's own web app uses, but
they vary by watch model and firmware — a device that doesn't record HRV simply
omits the key. This prints what we extracted next to what was available, so a
silently-missing metric is visible before it becomes a gap in a chart.

Reads a session from garmin_session.txt if it is there, otherwise signs in
interactively. Writes nothing anywhere.
"""

from __future__ import annotations

import base64
import getpass
import sys
from datetime import date, timedelta
from pathlib import Path

from garminconnect import Garmin

from garmin_client import fetch_day


def _client() -> Garmin:
    blob = Path("garmin_session.txt")
    if blob.exists():
        c = Garmin()
        c.login(tokenstore=base64.b64decode(blob.read_text()).decode("utf-8"))
        return c

    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password (not stored): ")
    c = Garmin(email=email, password=password,
               prompt_mfa=lambda: input("MFA code: ").strip())
    c.login()
    return c


def main() -> int:
    day = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else date.today() - timedelta(days=1)
    client = _client()
    ds = day.isoformat()

    print(f"\n=== what garmin_client.py extracted for {ds} ===")
    row = fetch_day(client, day)
    if not row:
        print("  nothing at all — was the watch worn?")
    else:
        for k, v in sorted(row.items()):
            print(f"  {k:18s} {v}")

    # Every metric the app can store. Anything listed here and absent above is
    # either genuinely unrecorded, or a field name we got wrong.
    expected = [
        "sleepMinutes", "deepMinutes", "remMinutes", "sleepScore",
        "restingHr", "hrvNight", "bodyBatteryHigh", "bodyBatteryLow",
        "stressAvg", "respirationAvg", "steps", "activeMinutes",
    ]
    missing = [k for k in expected if k not in (row or {})]
    if missing:
        print(f"\n  MISSING: {', '.join(missing)}")
        print("  Check the raw keys below before assuming the watch didn't record it.")

    print(f"\n=== raw keys Garmin returned for {ds} ===")
    for label, fn in [
        ("user_summary", lambda: client.get_user_summary(ds)),
        ("sleep.dailySleepDTO", lambda: (client.get_sleep_data(ds) or {}).get("dailySleepDTO")),
        ("hrv.hrvSummary", lambda: (client.get_hrv_data(ds) or {}).get("hrvSummary")),
    ]:
        try:
            data = fn() or {}
            keys = sorted(k for k, v in data.items() if v is not None) if isinstance(data, dict) else []
            print(f"\n  {label} ({len(keys)} non-null):")
            print("    " + ", ".join(keys) if keys else "    (nothing)")
        except Exception as e:  # noqa: BLE001
            print(f"\n  {label}: FAILED — {e}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
