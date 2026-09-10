# Garmin collector

Pulls sleep, resting HR, overnight HRV, Body Battery, stress and steps from
Garmin Connect every 6 hours and POSTs them to `/api/wearable/ingest`.

## How auth works

`garth` is **deprecated upstream** — Garmin's March 2026 TLS fingerprinting and
Cloudflare broke its mobile sign-in, and a login attempt here returned 429 from
`sso.garmin.com` before the password was even checked.

This uses **`garminconnect`** instead, which answered the same event by moving
to `curl_cffi` (a real browser TLS fingerprint) in 0.3.0, released days later,
and is still shipping. It layers several auth strategies: on a first successful
sign-in here, `mobile+cffi` and `mobile+requests` both returned 429 and a later
strategy still got through. Expect that in the logs; it is not a failure.

`garminconnect` 0.3.3+ needs **Python 3.12**, matching the `python312` runtime
in `firebase.json`. Keep those two in step.

## One-time setup

**1. Sign in locally** (this is the only step that needs your password, and it
never leaves your terminal):

```bash
cd garmin && python3.12 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && python login_local.py
```

Copy the base64 blob it prints.

**2. Create the three secrets:**

```bash
firebase functions:secrets:set GARMIN_SESSION
```

```bash
firebase functions:secrets:set WEARABLE_INGEST_SECRET
```

```bash
firebase functions:secrets:set WEARABLE_API_BASE
```

- `GARMIN_SESSION` — the blob from step 1
- `WEARABLE_INGEST_SECRET` — must match the value the `api` function uses
- `WEARABLE_API_BASE` — your hosting origin, e.g. `https://<project>.web.app`

**3. Add `WEARABLE_INGEST_SECRET` to the `api` function's secrets list** in
`server/src/functions.ts`, then redeploy `api`. Until then `/ingest` returns 503
by design — it refuses to accept anonymous writes to health data.

**4. Deploy just this codebase:**

```bash
firebase deploy --only functions:garmin
```

Deploying by codebase matters — see the warning in `server/src/functions.ts`
about deploys pruning each other's functions.

## Backfill

The first run takes the last 10 days, then each subsequent run takes another 45
days of history until it reaches two years back. That is ~17 runs, so about four
days at the 6-hourly schedule. To drive it faster, hit the manual trigger:

```bash
curl -X POST -H "x-ingest-secret: $SECRET" https://us-central1-<project>.cloudfunctions.net/garminsyncnow
```

The recent window is always re-fetched, because Garmin revises a night's sleep
and Body Battery for a day or two afterwards.

## When it breaks

The OAuth token lasts roughly a year and refreshes itself. When it finally
expires, the sync writes `status: error` against the sync row and the Body page
shows "Garmin sync is failing" with the reason. Re-run `login_local.py` and
update `GARMIN_SESSION`.

If a single Garmin endpoint changes shape, only that metric goes missing —
each group is fetched independently — and the rest of the sync still lands.
