#!/bin/bash
# Reviews new test-set videos in the Google Drive "Match Footage" folder.
# Run hourly by launchd (see install-footage-review.sh), or by hand.
#
# Reads:  ~/Library/CloudStorage/GoogleDrive-*/My Drive/Match Footage   (Google Drive for desktop)
# Writes: ~/BallBoiTestSet/Review/Review.md, review.json, run.log
# Never writes to the shared Drive folder, so friends don't see the review.

export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:$PATH"
FOLDER_NAME="${BALLBOI_FOOTAGE_FOLDER:-Match Footage}"
OUT="$HOME/BallBoiTestSet/Review"
mkdir -p "$OUT"
exec >>"$OUT/run.log" 2>&1
echo "== $(date '+%Y-%m-%d %H:%M')"

FOLDER=""
for root in "$HOME"/Library/CloudStorage/GoogleDrive-*; do
  for candidate in "$root/My Drive/$FOLDER_NAME" "$root/Shared drives/$FOLDER_NAME" "$root/.shortcut-targets-by-id"/*/"$FOLDER_NAME"; do
    [ -d "$candidate" ] && FOLDER="$candidate" && break 2
  done
done
if [ -z "$FOLDER" ]; then
  echo "Can't find the '$FOLDER_NAME' folder. Is Google Drive for desktop installed and signed in?"
  exit 0
fi

# Download new videos first (Drive for desktop may only keep a placeholder on disk).
shopt -s nullglob
for f in "$FOLDER"/*; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  case "$name" in *.md|*.txt|*.json|*.pdf|*.jpg|*.jpeg|*.png|*.heic) continue ;; esac
  if ! grep -qF "\"file\": \"$name\"" "$OUT/review.json" 2>/dev/null; then
    cat "$f" > /dev/null || echo "Couldn't download $name yet"
  fi
done

if ! docker info >/dev/null 2>&1; then
  open -g -a Docker
  for i in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running; will try next hour."
  exit 0
fi

docker run --rm -v "$FOLDER":/footage:ro -v "$OUT":/out ballboi-ml python -m intake scan /footage --out /out

if [ -s "$OUT/new.txt" ]; then
  count=$(wc -l < "$OUT/new.txt" | tr -d ' ')
  first=$(head -1 "$OUT/new.txt" | sed 's/"/\\"/g' | cut -c1-180)
  title="Ball Boi: $count new video$( [ "$count" != 1 ] && echo s ) reviewed"
  osascript -e "display notification \"$first\" with title \"$title\" sound name \"default\""
fi
