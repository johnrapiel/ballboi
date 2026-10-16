# Ball Boi

Tennis league app: leagues, scheduling, standings, score recording, and Ball Boi match analysis.

## Run locally

You need Node 22+, pnpm 10, and Docker Desktop.

```sh
pnpm install
cp .env.example .env      # then add your Clerk development keys
pnpm db:up                # starts Postgres + MinIO (video storage) in Docker
pnpm db:push              # creates the tables (first run, and after schema changes)
pnpm dev                  # API on :8080, app on :5173
```

Open http://localhost:5173. Sign up, and use the email you set as `ADMIN_EMAIL` to get admin access.

Optional, for Ball Boi video analysis:

```sh
pip install -r artifacts/ml-server/requirements-dev.txt
pnpm dev:ml               # ML server on :8000
```

## Tests

```sh
pnpm test
pnpm typecheck
```

## Video storage

Match video lives in S3-compatible storage. Locally that's MinIO (console at http://localhost:9001, login `ballboi` / `ballboi-dev-secret`). Production uses Cloudflare R2:

1. Create an R2 bucket and an API token with Object Read & Write on it.
2. Set `R2_ACCOUNT_ID`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`. Leave `STORAGE_ENDPOINT` unset.
3. Add a CORS rule on the bucket allowing `PUT` and `GET` from your web app origin, with `Content-Type` as an allowed header.
4. Copy existing Replit videos once with `scripts/migrate-replit-storage.mjs` (run it on Replit, where the old storage is reachable).

## Known local gaps

- **Push notifications** need VAPID keys in `.env` (see `.env.example`).

## Layout

- `artifacts/api-server`: Express API (`/api/*`)
- `artifacts/tennis-league`: React + Vite web app
- `artifacts/ml-server`: FastAPI service for Ball Boi analysis
- `lib/db`: Postgres schema (Drizzle)
- `lib/api-spec`: OpenAPI spec; generates `lib/api-zod` and `lib/api-client-react`
- `scripts/migrations`: SQL migrations, applied automatically when the API starts
