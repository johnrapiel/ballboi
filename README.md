# Ball Boi

Tennis league app: leagues, scheduling, standings, score recording, and Ball Boi match analysis.

## Run locally

You need Node 22+, pnpm 10, and Docker Desktop.

```sh
pnpm install
cp .env.example .env      # then add your Clerk development keys
pnpm db:up                # starts Postgres in Docker
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

## Known local gaps

- **Video upload and replay** still use Replit's object storage, which only works on Replit. Everything else runs locally. Moving storage to S3 or Cloudflare R2 fixes this.
- **Push notifications** need VAPID keys in `.env` (see `.env.example`).

## Layout

- `artifacts/api-server`: Express API (`/api/*`)
- `artifacts/tennis-league`: React + Vite web app
- `artifacts/ml-server`: FastAPI service for Ball Boi analysis
- `lib/db`: Postgres schema (Drizzle)
- `lib/api-spec`: OpenAPI spec; generates `lib/api-zod` and `lib/api-client-react`
- `scripts/migrations`: SQL migrations, applied automatically when the API starts
