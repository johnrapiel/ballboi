#!/bin/sh
# Runs the API server and web app together for local development.
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
WEB_PORT="${WEB_PORT:-5173}"

trap 'kill 0' INT TERM EXIT

PORT="$API_PORT" pnpm --filter @workspace/api-server run dev &
PORT="$WEB_PORT" BASE_PATH=/ API_PORT="$API_PORT" pnpm --filter @workspace/tennis-league run dev &

echo ""
echo "  App: http://localhost:$WEB_PORT"
echo "  API: http://localhost:$API_PORT/api"
echo ""
wait
