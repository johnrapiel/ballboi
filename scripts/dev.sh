#!/bin/sh
# Runs the API server for local development. Start the iOS app with: pnpm dev:mobile
# Usage: pnpm dev
set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Missing .env. Run: cp .env.example .env  (then add your Clerk keys)" >&2
  exit 1
fi

set -a
. ./.env
set +a

API_PORT="${API_PORT:-8080}"

trap 'kill 0' INT TERM EXIT

PORT="$API_PORT" pnpm --filter @workspace/api-server run dev &

echo ""
echo "  API: http://localhost:$API_PORT/api"
echo ""
wait
