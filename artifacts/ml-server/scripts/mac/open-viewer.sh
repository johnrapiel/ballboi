#!/bin/bash
# Opens the labeling tool with the analysis viewer, running in Docker with the real models.
# Videos come from the Google Drive "Match Footage" folder (read-only); labels and
# analysis results are saved in your ballboi checkout, ready to commit.
#
#   bash scripts/mac/open-viewer.sh          (stop it with Ctrl + C)

export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:$PATH"
FOLDER_NAME="${BALLBOI_FOOTAGE_FOLDER:-Match Footage}"
REPO="${BALLBOI_REPO:-$HOME/ballboi}"
EVAL="$REPO/artifacts/ml-server/evaluation"
PORT="${BALLBOI_VIEWER_PORT:-8010}"

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
mkdir -p "$EVAL/labels" "$EVAL/analysis"

if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker..."; open -g -a Docker
  for i in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
fi
docker info >/dev/null 2>&1 || { echo "Docker isn't running."; exit 1; }

echo "Opening http://127.0.0.1:$PORT  (Ctrl + C to stop)"
(sleep 4; open "http://127.0.0.1:$PORT") &
docker run --rm --name ballboi-viewer -p "127.0.0.1:$PORT:8010" \
  -v "$FOLDER":/videos:ro -v "$EVAL/labels":/labels -v "$EVAL/analysis":/analysis \
  ballboi-ml python -m labeling --videos /videos --labels /labels --analysis /analysis \
  --host 0.0.0.0 --port 8010 --no-browser
