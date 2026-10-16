# Ball Boi

Tennis league app: leagues, scheduling, standings, score recording, and Ball Boi match analysis.

## Run locally

You need Node 22+, pnpm 10, and Docker Desktop.

```sh
pnpm install
cp .env.example .env      # then add your Clerk development keys
pnpm db:up                # starts Postgres and S3 storage (SeaweedFS) in Docker, creates the bucket
pnpm db:push              # creates the tables (first run, and after schema changes)
pnpm dev                  # API on :8080, app on :5173
```

Open http://localhost:5173. Sign up, and use the email you set as `ADMIN_EMAIL` to get admin access.

### iOS app (Expo)

Needs Xcode from the Mac App Store (open it once to finish setup and install an iOS Simulator runtime). With `pnpm dev` running in another terminal:

```sh
pnpm dev:ios              # starts Metro and opens the app in the iOS Simulator
```

The first run installs Expo Go for SDK 54 into the Simulator. The App Store version of Expo Go on a physical iPhone only supports the latest SDK, so it won't open this project. Running on a device needs a development build.

In Clerk, enable the Native API for your instance (Native applications page in the dashboard) and make sure email + password sign-in is on; the app signs in with email and password.

Optional, for Ball Boi video analysis (needs Python 3.10+; macOS's built-in `python3` is too old):

```sh
python3.11 -m venv artifacts/ml-server/.venv
artifacts/ml-server/.venv/bin/pip install -r artifacts/ml-server/requirements-dev.txt
pnpm dev:ml               # ML server on :8000; uses the .venv if present
```

`ultralytics` and `mediapipe` improve detection but are optional and large; see `artifacts/ml-server/requirements.txt`.

## Tests

```sh
pnpm test
pnpm typecheck
cd artifacts/ml-server && .venv/bin/python -m pytest tests
```

## Video storage

Ball Boi videos go to any S3-compatible bucket, configured with the `S3_*` variables in `.env`. Locally that's the SeaweedFS container. Browsers and the iOS app upload and play video through presigned URLs, so in production the bucket needs a CORS rule that allows `GET` and `PUT` from the web app's origin. For Cloudflare R2, set `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com` and `S3_REGION=auto`. For AWS S3, leave `S3_ENDPOINT` empty.

Videos recorded on Replit are still in Replit's bucket. The database stores paths like `/objects/uploads/<id>`, which map to the key `uploads/<id>` in the new bucket. Copy those objects over to keep old replays working.

## Known local gaps

- **iOS push notifications** don't work in the Simulator, and Expo push tokens also need an Expo account and EAS project ID. The rest of the app works without them.
- **Push notifications** need VAPID keys in `.env` (see `.env.example`). Without them the app runs and skips sending.
- **`pnpm typecheck`** fails on errors that came over from Replit (duplicate exports in `lib/api-zod`, plus type errors in the API and web packages). Tests and builds pass.

## Layout

- `artifacts/api-server`: Express API (`/api/*`)
- `artifacts/tennis-league`: React + Vite web app
- `artifacts/mobile`: Expo (SDK 54) iOS app
- `artifacts/ml-server`: FastAPI service for Ball Boi analysis
- `lib/db`: Postgres schema (Drizzle)
- `lib/api-spec`: OpenAPI spec; generates `lib/api-zod` and `lib/api-client-react`
- `scripts/migrations`: SQL migrations, applied automatically when the API starts
