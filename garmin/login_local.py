"""One-time Garmin sign-in, run on your own machine.

    cd garmin
    source venv/bin/activate
    python login_local.py

Uses `garminconnect`, not `garth`. garth's mobile sign-in was killed by Garmin's
TLS fingerprinting and Cloudflare in March 2026 and is deprecated upstream;
garminconnect answered the same event by moving to `curl_cffi`, which presents a
real browser TLS fingerprint. That is the whole reason this works and garth's
`login_local` returned 429 before it even checked the password.

It asks for your Garmin email and password, handles the MFA code if your account
has one, and prints a base64 blob to paste into Secret Manager as GARMIN_SESSION.

Your password is typed into your own terminal, is never stored, never written to
disk, and goes nowhere but Garmin. What gets saved is the OAuth token pair Garmin
hands back. Those refresh themselves; the long-lived one lasts about a year, and
when it expires the app shows "Garmin sync is failing" and you run this again.
"""

from __future__ import annotations

import base64
import getpass
import sys
from pathlib import Path

from garminconnect import Garmin


def _prompt_mfa() -> str:
    return input("MFA code from your authenticator/email: ").strip()


def main() -> int:
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password (not stored): ")

    print("\nSigning in…", file=sys.stderr)
    try:
        client = Garmin(email=email, password=password, prompt_mfa=_prompt_mfa)
        # No tokenstore: we serialise in memory below. Passing a temp directory
        # here does NOT work — garminconnect's token_file_path() rejects any
        # symlinked path, and on macOS tempfile puts you under /var/folders,
        # where /var is a symlink to /private/var. The dump is wrapped in
        # contextlib.suppress upstream, so it fails silently and you get an
        # empty directory and a very confusing error.
        client.login()
    except Exception as e:  # noqa: BLE001
        print(f"\nSign-in failed: {e}", file=sys.stderr)
        print(
            "\nIf this is a 403/429 from Cloudflare, the impersonation was rejected —\n"
            "try again on a different network, or fall back to the official Health API.",
            file=sys.stderr,
        )
        return 1

    # Prove the session works before handing over a blob that might
    # authenticate but not authorise.
    try:
        print(f"Signed in as {client.get_full_name()}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"Signed in, but a test request failed: {e}", file=sys.stderr)
        return 1

    # `dumps()` is the inline-JSON form of the session, and `login(tokenstore=…)`
    # accepts that same string straight back. No files, no directories, nothing
    # for a symlink check to object to.
    blob = base64.b64encode(client.client.dumps().encode("utf-8")).decode("ascii")

    # Deliberately NOT printed to the screen. This blob is a live credential —
    # anything on your terminal can end up pasted into a chat, a screenshot or
    # a scrollback buffer.
    out = Path("garmin_session.txt")
    out.write_text(blob)
    out.chmod(0o600)

    print(
        f"\nSession written to {out.resolve()} (mode 600, git-ignored).\n\n"
        "Load it into Secret Manager without ever displaying it:\n"
        f"  firebase functions:secrets:set GARMIN_SESSION < {out}\n\n"
        "Then delete it:\n"
        f"  rm {out}\n",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
