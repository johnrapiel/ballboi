#!/bin/bash
# Opens the labeling tool with the analysis viewer, running in Docker with the real models.
# Videos come from the Google Drive "Match Footage" folder (read-only), or with --beta from
# the beta recordings download-beta.sh saved in ~/BallBoiTestSet/Beta. Labels and analysis
# results are saved in your ballboi checkout, ready to commit.
#
#   bash scripts/mac/open-viewer.sh          Match Footage (Drive)   (stop it with Ctrl + C)
#   bash scripts/mac/open-viewer.sh --beta   beta recordings

export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin"
FOLDER_NAME="${BALLBOI_FOOTAGE_FOLDER:-Match Footage}"
BETA_FOLDER="${BALLBOI_BETA_FOLDER:-$HOME/BallBoiTestSet/Beta}"
REPO="${BALLBOI_REPO:-$HOME/ballboi}"
EVAL="$REPO/artifacts/ml-server/evaluation"
PORT="${BALLBOI_VIEWER_PORT:-8010}"
IMAGE="ballboi-ml"

MODE="drive"
case "$1" in
  --beta) MODE="beta" ;;
  "") ;;
  *) echo "Unknown option: $1  (use --beta for beta recordings)"; exit 1 ;;
esac

# Runs a command, giving up after N seconds (macOS has no `timeout`). Returns 124 on timeout.
run_with_timeout() {
  local secs="$1"; shift
  "$@" >/dev/null 2>&1 &
  local pid=$! ticks=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$ticks" -ge $((secs * 10)) ]; then
      kill "$pid" 2>/dev/null; sleep 0.2; kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 124
    fi
    sleep 0.1; ticks=$((ticks + 1))
  done
  wait "$pid"
}

docker_running() { run_with_timeout "${1:-4}" docker info; }

# ── Videos ───────────────────────────────────────────────────────────────────
if [ "$MODE" = "beta" ]; then
  FOLDER="$BETA_FOLDER"
  if [ ! -d "$FOLDER" ] || [ -z "$(ls -A "$FOLDER" 2>/dev/null | grep -v '\.part$')" ]; then
    echo "No beta recordings on this Mac yet ($FOLDER)."
    echo "Double-click Download beta recordings first, then open this again."
    exit 1
  fi
else
  FOLDER=""
  for root in "$HOME"/Library/CloudStorage/GoogleDrive-*; do
    for candidate in "$root/My Drive/$FOLDER_NAME" "$root/Shared drives/$FOLDER_NAME" "$root/.shortcut-targets-by-id"/*/"$FOLDER_NAME"; do
      [ -d "$candidate" ] && FOLDER="$candidate" && break 2
    done
  done
  if [ -z "$FOLDER" ]; then
    echo "Can't find the '$FOLDER_NAME' folder. Is Google Drive for desktop installed and signed in?"
    exit 1
  fi
fi
mkdir -p "$EVAL/labels" "$EVAL/analysis"

# ── Docker ───────────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1 && [ ! -d /Applications/Docker.app ]; then
  echo "Docker Desktop isn't installed."
  echo "Install Docker Desktop for Mac (Intel chip) from docker.com, open it once, then try again."
  exit 1
fi

if ! docker_running; then
  echo "Docker Desktop isn't running. Starting it now..."
  open -g -a Docker 2>/dev/null
  started=""
  for _ in 1 2; do
    sleep 2
    docker_running 3 && started=1 && break
  done
  if [ -z "$started" ]; then
    echo "Docker Desktop is still starting."
    echo "Open Docker Desktop and wait until it says it's running, then try again."
    exit 1
  fi
fi

if ! run_with_timeout 10 docker image inspect "$IMAGE"; then
  echo "First run: building the Ball Boi analysis image."
  echo "This takes 10 to 20 minutes, once. Later runs start in seconds."
  if ! docker build -t "$IMAGE" "$REPO/artifacts/ml-server"; then
    echo "The build didn't finish. Check this Mac is online, then try again."
    exit 1
  fi
fi

# ── Start ────────────────────────────────────────────────────────────────────
[ "$MODE" = "beta" ] && echo "Beta recordings from $FOLDER"
echo "Opening http://127.0.0.1:$PORT  (Ctrl + C to stop)"
(sleep 4; open "http://127.0.0.1:$PORT") &
docker run --rm --name ballboi-viewer -p "127.0.0.1:$PORT:8010" \
  -v "$FOLDER":/videos:ro -v "$EVAL/labels":/labels -v "$EVAL/analysis":/analysis \
  "$IMAGE" python -m labeling --videos /videos --labels /labels --analysis /analysis \
  --host 0.0.0.0 --port 8010 --no-browser
