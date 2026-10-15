#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db exec node ../../scripts/run-db-migrations.mjs
python3.11 -m pip install -r artifacts/ml-server/requirements-dev.txt --quiet
