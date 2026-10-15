#!/bin/sh
# Loads .env into the environment, then runs the given command.
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
exec "$@"
