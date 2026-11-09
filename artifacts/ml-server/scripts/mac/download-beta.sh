#!/bin/bash
# Downloads beta recordings that may be used for testing into ~/BallBoiTestSet/Beta,
# one file per match, skipping ones already downloaded. Read-only: never deletes or
# changes anything in R2, the database or the folder. Settings come from ~/ballboi/.env
# (see labeling/README.md, "Label beta recordings").
#
#   bash scripts/mac/download-beta.sh        (or double-click "Download beta recordings")

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
REPO="${BALLBOI_REPO:-$HOME/ballboi}"
ML="$REPO/artifacts/ml-server"

if [ ! -d "$ML/labeling" ]; then
  echo "Can't find your ballboi checkout at $REPO."
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 isn't installed. In Terminal, run: xcode-select --install"
  exit 1
fi
cd "$ML" && python3 -m labeling.beta_footage --env "$REPO/.env" "$@"
