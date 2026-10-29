#!/bin/bash
# Installs the hourly footage review on this Mac (a launchd agent), then runs it once.
#   Remove it:  bash install-footage-review.sh --uninstall
set -e
LABEL="tennis.ballboi.footage-review"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BIN="$HOME/BallBoiTestSet/.bin"

if [ "$1" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Footage review removed."
  exit 0
fi

mkdir -p "$BIN" "$HOME/BallBoiTestSet/Review" "$HOME/Library/LaunchAgents"
cp "$(dirname "$0")/review-footage.sh" "$BIN/review-footage.sh"
chmod +x "$BIN/review-footage.sh"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$BIN/review-footage.sh</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Footage review installed: runs now, then every hour while you're logged in."
echo "Results: $HOME/BallBoiTestSet/Review/Review.md"
