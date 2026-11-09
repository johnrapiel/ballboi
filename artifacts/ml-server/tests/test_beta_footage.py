"""Beta recordings download (labeling/beta_footage.py) and the viewer's Docker checks.

Which matches are eligible (release agreed, held for beta, withdrawn excluded) is
decided by the API (artifacts/api-server/src/lib/betaFootage.ts, tested in
betaFootage.test.ts). Here: the script only downloads what the API lists,
skips what's already here, names withdrawn files, and never deletes anything.
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from labeling import beta_footage as bf  # noqa: E402

ML_DIR = Path(__file__).resolve().parents[1]
ENV = Path("/tmp/does-not-matter/.env")
SETTINGS = bf.Settings(clerk_secret="sk_test_abc", admin_email="john@example.com", api_url="https://api.example")


def match(match_id, day="2026-11-08", session_id=None):
    return {
        "matchId": match_id,
        "sessionId": session_id or match_id * 10,
        "recordedAt": f"{day}T18:00:00.000Z",
        "url": f"https://r2.example/training/session-{match_id}.mp4?sig=x",
        "expiresAt": f"{day}T20:00:00.000Z",
    }


class FakeHttp(bf.Http):
    """Clerk and the staging API, in memory. Downloads write a few bytes."""

    def __init__(self, listing, admin_status=200, fail_downloads=()):
        self.listing = listing
        self.admin_status = admin_status
        self.fail_downloads = set(fail_downloads)
        self.calls = []
        self.downloads = []
        self.revoked = []

    def request(self, method, url, headers, body=None):
        self.calls.append((method, url))
        if url.startswith(bf.CLERK_API + "/users"):
            assert headers["Authorization"] == "Bearer sk_test_abc"
            return 200, [{"id": "user_john"}]
        if url == bf.CLERK_API + "/sessions":
            assert body == {"user_id": "user_john"}
            return 200, {"id": "sess_1"}
        if url == bf.CLERK_API + "/sessions/sess_1/tokens":
            return 200, {"jwt": "jwt_1"}
        if url == bf.CLERK_API + "/sessions/sess_1/revoke":
            self.revoked.append("sess_1")
            return 200, {}
        if url == "https://api.example/api/admin/beta-footage":
            assert headers["Authorization"] == "Bearer jwt_1"
            return self.admin_status, self.listing if self.admin_status == 200 else {"error": "no"}
        raise AssertionError(f"unexpected request {method} {url}")

    def download(self, url, dest):
        self.downloads.append(url)
        if url in self.fail_downloads:
            return False
        Path(dest).write_bytes(b"video")
        return True


def run(folder, http, clock=None):
    lines = []
    code = bf.run(folder, SETTINGS, http, say=lines.append, clock=clock or (lambda: 0.0))
    return code, "\n".join(lines)


# ─── Naming and what's already here ──────────────────────────────────────────


def test_file_name_is_date_and_match_id():
    assert bf.file_name(match(123)) == "2026-11-08-beta-match-123.mp4"


def test_local_files_ignores_unfinished_empty_and_other_files(tmp_path):
    (tmp_path / "2026-11-08-beta-match-1.mp4").write_bytes(b"x")
    (tmp_path / "2026-11-08-beta-match-2.mp4.part").write_bytes(b"x")
    (tmp_path / "2026-11-08-beta-match-3.mp4").write_bytes(b"")
    (tmp_path / "bubble-night.mp4").write_bytes(b"x")
    assert list(bf.local_files(tmp_path)) == [1]
    assert bf.local_files(tmp_path / "missing") == {}


def test_plan_skips_already_downloaded_by_match_id(tmp_path):
    here = tmp_path / "2026-11-07-beta-match-1.mp4"  # date doesn't need to match
    plan = bf.make_plan({"matches": [match(1), match(2)], "withdrawnMatchIds": []}, {1: here})
    assert [m["matchId"] for m in plan.download] == [2]
    assert plan.already == [here]
    assert plan.withdrawn_local == [] and plan.unlisted_local == []


def test_plan_names_withdrawn_and_unlisted_local_files(tmp_path):
    local = {1: tmp_path / "a.mp4", 2: tmp_path / "b.mp4", 3: tmp_path / "c.mp4"}
    plan = bf.make_plan({"matches": [match(3)], "withdrawnMatchIds": [1, 99]}, local)
    assert plan.download == []
    assert plan.withdrawn_local == [tmp_path / "a.mp4"]
    assert plan.unlisted_local == [tmp_path / "b.mp4"]


# ─── Settings ────────────────────────────────────────────────────────────────


def test_read_env_file_handles_comments_quotes_and_export(tmp_path):
    p = tmp_path / ".env"
    p.write_text("# c\nexport CLERK_SECRET_KEY='sk_test_a'\nADMIN_EMAIL=\"j@x.com\"\n\nBAD\n")
    assert bf.read_env_file(p) == {"CLERK_SECRET_KEY": "sk_test_a", "ADMIN_EMAIL": "j@x.com"}
    assert bf.read_env_file(tmp_path / "missing") == {}


@pytest.mark.parametrize("env, needle", [
    ({}, "CLERK_SECRET_KEY=sk_test_"),
    ({"CLERK_SECRET_KEY": "sk_test_xxx", "ADMIN_EMAIL": "j@x.com"}, "CLERK_SECRET_KEY=sk_test_"),
    ({"CLERK_SECRET_KEY": "sk_live_abc", "ADMIN_EMAIL": "j@x.com"}, "Development key"),
    ({"CLERK_SECRET_KEY": "sk_test_abc"}, "ADMIN_EMAIL="),
    ({"CLERK_SECRET_KEY": "sk_test_abc", "ADMIN_EMAIL": "you@example.com"}, "ADMIN_EMAIL="),
])
def test_missing_settings_say_which_line_and_where(env, needle):
    with pytest.raises(bf.SetupError) as err:
        bf.check_settings(env, ENV)
    assert needle in str(err.value)
    assert str(ENV) in str(err.value) or "dashboard.clerk.com" in str(err.value)


def test_settings_default_to_the_staging_api():
    s = bf.check_settings({"CLERK_SECRET_KEY": "sk_test_abc", "ADMIN_EMAIL": "j@x.com"}, ENV)
    assert s.api_url == bf.DEFAULT_API_URL
    s = bf.check_settings({"CLERK_SECRET_KEY": "sk_test_abc", "ADMIN_EMAIL": "j@x.com",
                           "BALLBOI_STAGING_API_URL": "https://other.example/"}, ENV)
    assert s.api_url == "https://other.example"


def test_main_with_no_env_lines_prints_the_missing_line(tmp_path, capsys, monkeypatch):
    for k in ("CLERK_SECRET_KEY", "ADMIN_EMAIL"):
        monkeypatch.delenv(k, raising=False)
    code = bf.main(["--env", str(tmp_path / ".env"), "--folder", str(tmp_path / "Beta")])
    assert code == 2
    out = capsys.readouterr().out
    assert "CLERK_SECRET_KEY" in out and "dashboard.clerk.com" in out


# ─── A run ───────────────────────────────────────────────────────────────────


def test_first_run_downloads_each_match_once_then_second_run_says_nothing_new(tmp_path):
    http = FakeHttp({"matches": [match(1), match(2, "2026-11-09")], "withdrawnMatchIds": [], "missingCount": 0})
    code, out = run(tmp_path, http)
    assert code == 0
    assert sorted(p.name for p in tmp_path.iterdir()) == ["2026-11-08-beta-match-1.mp4", "2026-11-09-beta-match-2.mp4"]
    assert "downloaded 2 new matches" in out
    assert http.revoked == ["sess_1"]  # the short session is ended

    http2 = FakeHttp(http.listing)
    code, out = run(tmp_path, http2)
    assert code == 0
    assert http2.downloads == []
    assert "Nothing new: all 2 beta matches are already on this Mac" in out


def test_withdrawn_matches_never_download_and_local_copies_are_named_not_deleted(tmp_path):
    kept = tmp_path / "2026-11-08-beta-match-5.mp4"
    kept.write_bytes(b"old")
    http = FakeHttp({"matches": [match(1)], "withdrawnMatchIds": [5, 6], "missingCount": 0})
    code, out = run(tmp_path, http)
    assert code == 0
    assert [u for u in http.downloads if "session-5" in u or "session-6" in u] == []
    assert kept.exists()  # never deleted by the script
    assert "A player withdrew" in out and str(kept) in out
    assert "doesn't delete anything" in out


def test_nothing_ready_yet(tmp_path):
    code, out = run(tmp_path, FakeHttp({"matches": [], "withdrawnMatchIds": [], "missingCount": 0}))
    assert code == 0
    assert "No beta matches are ready for testing yet" in out


def test_failed_download_keeps_nothing_half_named_and_says_run_again(tmp_path):
    m = match(1)
    http = FakeHttp({"matches": [m], "withdrawnMatchIds": []}, fail_downloads=[m["url"]])
    code, out = run(tmp_path, http)
    assert code == 1
    assert bf.local_files(tmp_path) == {}
    assert "Run this again to finish" in out


def test_links_are_refreshed_before_they_expire(tmp_path):
    http = FakeHttp({"matches": [match(1), match(2)], "withdrawnMatchIds": []})
    times = iter([0.0, 0.0, bf.REFRESH_AFTER_SECONDS + 1, bf.REFRESH_AFTER_SECONDS + 1])
    code, _ = run(tmp_path, http, clock=lambda: next(times, bf.REFRESH_AFTER_SECONDS + 1))
    assert code == 0
    assert sum(1 for c in http.calls if c[1].endswith("/api/admin/beta-footage")) == 2


@pytest.mark.parametrize("status, needle", [(403, "isn't the admin"), (401, "didn't accept the sign-in"), (404, "next staging deploy")])
def test_api_refusals_are_plain(tmp_path, status, needle):
    with pytest.raises(bf.SetupError) as err:
        run(tmp_path, FakeHttp({}, admin_status=status))
    assert needle in str(err.value)


# ─── Real curl against a local server ────────────────────────────────────────


@pytest.mark.skipif(shutil.which("curl") is None, reason="curl not installed")
def test_curl_http_sends_headers_on_stdin_and_downloads(tmp_path):
    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            seen["auth"] = self.headers.get("Authorization")
            seen["ua"] = self.headers.get("User-Agent")
            seen["body"] = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            payload = json.dumps({"id": "sess_1"}).encode()
            self.send_response(201)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path == "/missing":
                self.send_response(403)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Length", "5")
            self.end_headers()
            self.wfile.write(b"video")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        http = bf.CurlHttp()
        status, data = http.request("POST", f"{base}/v1/sessions", {"Authorization": "Bearer sk_test_abc"}, {"user_id": "u"})
        assert status == 201 and data == {"id": "sess_1"}
        assert seen["auth"] == "Bearer sk_test_abc"
        assert seen["ua"] == bf.USER_AGENT
        assert json.loads(seen["body"]) == {"user_id": "u"}
        dest = tmp_path / "x.mp4.part"
        assert http.download(f"{base}/file", dest) and dest.read_bytes() == b"video"
        assert not http.download(f"{base}/missing", tmp_path / "y.part")
    finally:
        server.shutdown()


# ─── open-viewer.sh: Docker missing or stuck ─────────────────────────────────


def _viewer(tmp_path, docker_body):
    stubs = tmp_path / "bin"
    stubs.mkdir()
    (stubs / "docker").write_text(f"#!/bin/bash\n{docker_body}\n")
    (stubs / "open").write_text("#!/bin/bash\nexit 0\n")
    for f in stubs.iterdir():
        f.chmod(0o755)
    beta = tmp_path / "Beta"
    beta.mkdir()
    (beta / "2026-11-08-beta-match-1.mp4").write_bytes(b"x")
    env = {**os.environ, "PATH": f"{stubs}:{os.environ['PATH']}", "BALLBOI_BETA_FOLDER": str(beta),
           "BALLBOI_REPO": str(tmp_path / "repo"), "HOME": str(tmp_path)}
    start = time.monotonic()
    proc = subprocess.run(["bash", str(ML_DIR / "scripts/mac/open-viewer.sh"), "--beta"], env=env,
                          capture_output=True, text=True, timeout=60)
    return proc, time.monotonic() - start


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash not installed")
def test_viewer_says_open_docker_when_it_isnt_running(tmp_path):
    proc, took = _viewer(tmp_path, "exit 1")
    assert proc.returncode == 1
    assert "Open Docker Desktop and wait until it says it's running" in proc.stdout
    assert took < 15


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash not installed")
def test_viewer_doesnt_hang_when_docker_info_hangs(tmp_path):
    proc, took = _viewer(tmp_path, "sleep 120")
    assert proc.returncode == 1
    assert "Open Docker Desktop and wait until it says it's running" in proc.stdout
    assert took < 20


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash not installed")
def test_viewer_beta_with_no_downloads_says_download_first(tmp_path):
    env = {**os.environ, "BALLBOI_BETA_FOLDER": str(tmp_path / "Beta"), "HOME": str(tmp_path)}
    proc = subprocess.run(["bash", str(ML_DIR / "scripts/mac/open-viewer.sh"), "--beta"], env=env,
                          capture_output=True, text=True, timeout=30)
    assert proc.returncode == 1
    assert "Download beta recordings first" in proc.stdout
