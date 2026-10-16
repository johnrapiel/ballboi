#!/bin/sh
# Starts Metro for the Expo app so Expo Go on a phone (same Wi-Fi/network) can load it.
# Usage: pnpm dev:mobile   (run `pnpm dev` in another terminal for the API)
set -e
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# The phone can't reach "localhost" on this Mac, so point the app at the Mac's LAN address
# unless EXPO_PUBLIC_API_URL is already set.
if [ -z "$EXPO_PUBLIC_API_URL" ]; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  if [ -z "$LAN_IP" ]; then
    echo "Couldn't find this Mac's network address. Set EXPO_PUBLIC_API_URL in .env, e.g. http://192.168.1.20:8080" >&2
    exit 1
  fi
  export EXPO_PUBLIC_API_URL="http://$LAN_IP:${API_PORT:-8080}"
fi

echo ""
echo "  App will call the API at $EXPO_PUBLIC_API_URL"
echo "  Scan the QR code below with your iPhone camera to open it in Expo Go."
echo ""
exec pnpm --filter @workspace/mobile exec expo start
