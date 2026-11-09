"""
Download beta recordings to this Mac for the labeled test set.

    python3 -m labeling.beta_footage            (or double-click "Download beta recordings")

Asks the staging API's admin-only GET /api/admin/beta-footage route for the
matches that may be used for testing (held for beta, the recorder agreed to the
Beta Footage Release, nobody withdrew), then downloads each one once into
~/BallBoiTestSet/Beta as <date>-beta-match-<id>.mp4.

Read-only: it never deletes or changes anything in R2, the database or this
folder. When a downloaded match is later withdrawn, it says which file to
delete. Video goes straight from Ball Boi's R2 bucket to this Mac (B16).

Sign-in: the admin route needs John's admin account. The script uses the Clerk
Development secret key already in ~/ballboi/.env to start a short session for
ADMIN_EMAIL (Clerk's testing sessions; Development instances only), gets a
one-minute token, and ends the session when it's done. Staging uses the same
Clerk instance as local development.

Standard library only (macOS's built-in python3 works), Python 3.9+. HTTP goes
through /usr/bin/curl, which uses the Mac's own certificates.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple
from urllib.parse import quote

REPO = Path(__file__).resolve().parents[3]
DEFAULT_FOLDER = Path.home() / "BallBoiTestSet" / "Beta"
DEFAULT_API_URL = "https://ballboi-api-staging.jr-26c.workers.dev"
CLERK_API = "https://api.clerk.com/v1"
USER_AGENT = "BallBoi-beta-download/1"
FILE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-beta-match-(\d+)\.mp4$")
# Links from the API work for two hours; get fresh ones before then.
REFRESH_AFTER_SECONDS = 90 * 60

PLACEHOLDERS = {"", "sk_test_xxx", "you@example.com"}


class SetupError(Exception):
    """Something John needs to fix, in plain words."""


# ─── Settings ────────────────────────────────────────────────────────────────


def read_env_file(path: Path) -> Dict[str, str]:
    """KEY=value lines; comments, blanks and `export ` are fine. Missing file is empty."""
    values: Dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return values
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


@dataclass
class Settings:
    clerk_secret: str
    admin_email: str
    api_url: str


def check_settings(env: Dict[str, str], env_path: Path) -> Settings:
    """The lines this needs, with a plain message naming the first one missing."""
    secret = env.get("CLERK_SECRET_KEY", "").strip()
    if secret in PLACEHOLDERS:
        raise SetupError(
            f"Add this line to {env_path}:\n"
            "  CLERK_SECRET_KEY=sk_test_...\n"
            "Get it from dashboard.clerk.com > the Ball Boi Development instance (the one staging uses) "
            "> API Keys > Secret keys. It's the same key local development uses."
        )
    if not secret.startswith("sk_test_"):
        raise SetupError(
            f"CLERK_SECRET_KEY in {env_path} should be the Development key (it starts with sk_test_). "
            "Get it from dashboard.clerk.com > the Ball Boi Development instance > API Keys."
        )
    email = env.get("ADMIN_EMAIL", "").strip()
    if email in PLACEHOLDERS:
        raise SetupError(
            f"Add this line to {env_path}:\n"
            "  ADMIN_EMAIL=the email you sign in to Ball Boi with\n"
            "It must match the ADMIN_EMAIL secret on the staging API (GitHub > Settings > Secrets and variables > Actions)."
        )
    api_url = (env.get("BALLBOI_STAGING_API_URL", "").strip() or DEFAULT_API_URL).rstrip("/")
    return Settings(clerk_secret=secret, admin_email=email, api_url=api_url)


# ─── What to download ────────────────────────────────────────────────────────


def file_name(match: dict) -> str:
    """2026-11-08-beta-match-123.mp4: the recording's date (UTC) and the match ID."""
    return f"{str(match['recordedAt'])[:10]}-beta-match-{int(match['matchId'])}.mp4"


def local_files(folder: Path) -> Dict[int, Path]:
    """Beta recordings already in the folder, by match ID. Unfinished downloads (.part) don't count."""
    found: Dict[int, Path] = {}
    if not folder.is_dir():
        return found
    for p in sorted(folder.iterdir()):
        m = FILE_RE.match(p.name)
        if m and p.is_file() and p.stat().st_size > 0:
            found.setdefault(int(m.group(2)), p)
    return found


@dataclass
class Plan:
    download: List[dict] = field(default_factory=list)
    already: List[Path] = field(default_factory=list)
    withdrawn_local: List[Path] = field(default_factory=list)
    unlisted_local: List[Path] = field(default_factory=list)


def make_plan(listing: dict, local: Dict[int, Path]) -> Plan:
    """Pure: what to download, what's already here, and local files to tell John about."""
    plan = Plan()
    listed = set()
    for match in listing.get("matches", []):
        match_id = int(match["matchId"])
        listed.add(match_id)
        if match_id in local:
            plan.already.append(local[match_id])
        else:
            plan.download.append(match)
    withdrawn = {int(i) for i in listing.get("withdrawnMatchIds", [])}
    for match_id, path in sorted(local.items()):
        if match_id in withdrawn:
            plan.withdrawn_local.append(path)
        elif match_id not in listed:
            plan.unlisted_local.append(path)
    return plan


# ─── HTTP (curl) ─────────────────────────────────────────────────────────────


class Http:
    """What the script needs from the network. Tests replace it."""

    def request(self, method: str, url: str, headers: Dict[str, str], body: Optional[dict] = None) -> Tuple[int, object]:
        raise NotImplementedError

    def download(self, url: str, dest: Path) -> bool:
        raise NotImplementedError


class CurlHttp(Http):
    def request(self, method, url, headers, body=None):
        # Headers go in on stdin so the key never shows up in the process list.
        header_text = "".join(f"{k}: {v}\n" for k, v in {**headers, "User-Agent": USER_AGENT}.items())
        cmd = ["curl", "-sS", "--max-time", "90", "-X", method, "-H", "@-", "-w", "\n%{http_code}"]
        if body is not None:
            header_text += "Content-Type: application/json\n"
            cmd += ["--data-binary", json.dumps(body)]
        cmd.append(url)
        try:
            proc = subprocess.run(cmd, input=header_text, capture_output=True, text=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired) as err:
            raise SetupError(f"Couldn't reach {url.split('?')[0]}: {err}") from err
        if proc.returncode != 0:
            raise SetupError(
                f"Couldn't reach {url.split('?')[0]}. Check this Mac is online. ({proc.stderr.strip() or proc.returncode})"
            )
        text, _, status = proc.stdout.rpartition("\n")
        try:
            data = json.loads(text) if text.strip() else None
        except ValueError:
            data = None
        return int(status or 0), data

    def download(self, url, dest):
        # -C - picks up an unfinished download where it stopped.
        cmd = ["curl", "-fL", "-#", "-C", "-", "--retry", "3", "--retry-delay", "5", "-A", USER_AGENT, "-o", str(dest), url]
        return subprocess.run(cmd).returncode == 0


# ─── Talking to Clerk and the API ────────────────────────────────────────────


def admin_token(http: Http, settings: Settings) -> Tuple[str, Optional[str]]:
    """A one-minute session token for the admin account, and the session to end afterwards."""
    auth = {"Authorization": f"Bearer {settings.clerk_secret}"}
    status, users = http.request("GET", f"{CLERK_API}/users?email_address={quote(settings.admin_email)}", auth)
    if status in (401, 403):
        raise SetupError(
            "Clerk didn't accept CLERK_SECRET_KEY. Copy it again from dashboard.clerk.com > "
            "the Ball Boi Development instance > API Keys."
        )
    if status != 200 or not isinstance(users, list):
        raise SetupError(f"Clerk couldn't look up {settings.admin_email} (status {status}). Try again in a minute.")
    if not users:
        raise SetupError(
            f"No Ball Boi account uses {settings.admin_email}. Set ADMIN_EMAIL to the email you sign in to the app with."
        )
    user_id = users[0].get("id")
    status, session = http.request("POST", f"{CLERK_API}/sessions", auth, {"user_id": user_id})
    if status not in (200, 201) or not isinstance(session, dict) or not session.get("id"):
        raise SetupError(
            f"Clerk wouldn't start a session for the download (status {status}). "
            "This only works with the Development instance's key (sk_test_)."
        )
    session_id = session["id"]
    status, token = http.request("POST", f"{CLERK_API}/sessions/{session_id}/tokens", auth)
    if status != 200 or not isinstance(token, dict) or not token.get("jwt"):
        end_session(http, settings, session_id)
        raise SetupError(f"Clerk wouldn't issue a token for the download (status {status}). Try again in a minute.")
    return token["jwt"], session_id


def end_session(http: Http, settings: Settings, session_id: Optional[str]) -> None:
    if not session_id:
        return
    try:
        http.request("POST", f"{CLERK_API}/sessions/{session_id}/revoke", {"Authorization": f"Bearer {settings.clerk_secret}"})
    except SetupError:
        pass  # It expires on its own.


def fetch_listing(http: Http, settings: Settings) -> dict:
    token, session_id = admin_token(http, settings)
    try:
        status, data = http.request("GET", f"{settings.api_url}/api/admin/beta-footage", {"Authorization": f"Bearer {token}"})
    finally:
        end_session(http, settings, session_id)
    if status == 403:
        raise SetupError(
            f"The staging API says {settings.admin_email} isn't the admin. ADMIN_EMAIL in .env must match the "
            "ADMIN_EMAIL secret on the staging API."
        )
    if status == 401:
        raise SetupError(
            "The staging API didn't accept the sign-in. Check CLERK_SECRET_KEY is from the same Clerk instance "
            "staging uses (the Development instance)."
        )
    if status == 404:
        raise SetupError("The staging API doesn't have the beta download yet. It arrives with the next staging deploy.")
    if status != 200 or not isinstance(data, dict):
        raise SetupError(f"The staging API couldn't list beta recordings (status {status}). Try again in a minute.")
    return data


# ─── The run ─────────────────────────────────────────────────────────────────


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def run(folder: Path, settings: Settings, http: Http, say: Callable[[str], None] = print,
        clock: Callable[[], float] = time.monotonic) -> int:
    folder = folder.expanduser()
    folder.mkdir(parents=True, exist_ok=True)
    say("Checking the staging API for beta recordings (the first check can take a few seconds while it wakes up)...")
    listing = fetch_listing(http, settings)
    fetched_at = clock()
    plan = make_plan(listing, local_files(folder))
    total = len(listing.get("matches", []))

    downloaded, failed = 0, []
    for i, match in enumerate(plan.download, 1):
        if clock() - fetched_at > REFRESH_AFTER_SECONDS:
            listing = fetch_listing(http, settings)
            fetched_at = clock()
            fresh = {int(m["matchId"]): m for m in listing.get("matches", [])}
            if int(match["matchId"]) not in fresh:
                continue  # Withdrawn while we were downloading; the next run names it if it's here.
            match = fresh[int(match["matchId"])]
        name = file_name(match)
        dest = folder / name
        part = folder / (name + ".part")
        say(f"Downloading {name} ({i} of {len(plan.download)})")
        if http.download(match["url"], part):
            os.replace(part, dest)
            downloaded += 1
        else:
            failed.append(name)

    say("")
    if total == 0:
        say("No beta matches are ready for testing yet. A recording shows up here once Ball Boi has analyzed it.")
    elif downloaded:
        say(f"Done: downloaded {_plural(downloaded, 'new match', 'new matches')} to {folder}.")
        if plan.already:
            say(f"{_plural(len(plan.already), 'match was', 'matches were')} already on this Mac.")
    elif not failed:
        say(f"Nothing new: all {_plural(total, 'beta match is', 'beta matches are')} already on this Mac, in {folder}.")
    if failed:
        say(f"Couldn't download {_plural(len(failed), 'match', 'matches')}: {', '.join(failed)}. "
            "Run this again to finish; it picks up where it stopped.")
    missing = int(listing.get("missingCount") or 0)
    if missing:
        say(f"{_plural(missing, 'held recording was', 'held recordings were')} missing from storage and skipped.")
    if plan.withdrawn_local:
        say("")
        say("A player withdrew from these matches (Beta Footage Release, \"Withdrawing\"). Delete these files from "
            "this Mac. This script doesn't delete anything; labels you made can stay:")
        for p in plan.withdrawn_local:
            say(f"  {p}")
    if plan.unlisted_local:
        say("")
        say("These files are no longer on the testing list, for a reason other than withdrawal "
            "(for example the recording was removed). Check before labeling them:")
        for p in plan.unlisted_local:
            say(f"  {p}")
    return 1 if failed else 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="python3 -m labeling.beta_footage", description="Download beta recordings for labeling")
    parser.add_argument("--folder", type=Path, default=None, help=f"where to save them (default: {DEFAULT_FOLDER})")
    parser.add_argument("--env", type=Path, default=REPO / ".env", help="the .env file with the settings (default: your ballboi checkout's)")
    args = parser.parse_args(argv)

    env = {**read_env_file(args.env), **{k: v for k, v in os.environ.items() if k in (
        "CLERK_SECRET_KEY", "ADMIN_EMAIL", "BALLBOI_STAGING_API_URL", "BALLBOI_BETA_FOLDER")}}
    folder = args.folder or Path(env.get("BALLBOI_BETA_FOLDER") or DEFAULT_FOLDER)
    try:
        settings = check_settings(env, args.env)
        return run(folder, settings, CurlHttp())
    except SetupError as err:
        print(f"\n{err}")
        return 2
    except KeyboardInterrupt:
        print("\nStopped. Run it again to pick up where it left off.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
