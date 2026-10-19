# Ball Boi

iOS tennis app: find local players, run leagues, and record matches with Ball Boi shot analysis.

Start with `CLAUDE.md`. The product spec, design system, and App Store checklist live in `docs/`.

## Run locally

You need Node 22+, pnpm 10, Docker Desktop, and the Ball Boi development build on your iPhone (see "Install Ball Boi on your iPhone" below). The App Store's Expo Go app can't run Ball Boi: it lacks Sign in with Apple, push, and the native modules the app needs.

```sh
pnpm install
cp .env.example .env      # then add your Clerk development keys
pnpm db:up                # starts Postgres and S3 storage (SeaweedFS) in Docker, creates the bucket
pnpm db:push              # creates the tables (first run, and after schema changes)
pnpm dev                  # API on :8080
```

In a second terminal:

```sh
pnpm dev:mobile           # starts Metro; open the Ball Boi dev build on your iPhone
```

Your iPhone and Mac must be on the same network. The script points the app at this Mac's network address, because the phone can't reach `localhost`. If the phone can't connect, allow incoming connections for Node in macOS's firewall settings.

In Clerk, enable the Native API for your instance.

Optional, for Ball Boi video analysis (needs Python 3.10+; macOS's built-in `python3` is too old):

```sh
python3.11 -m venv artifacts/ml-server/.venv
artifacts/ml-server/.venv/bin/pip install -r artifacts/ml-server/requirements-dev.txt
pnpm dev:ml               # ML server on :8000; uses the .venv if present
```

`ultralytics` and `mediapipe` improve detection but are optional and large; see `artifacts/ml-server/requirements.txt`.

## Install Ball Boi on your iPhone

Ball Boi runs as a development build: your own copy of the app, built by EAS in the cloud. You need a paid Apple Developer account and a free Expo account. Do this once, then again only when native code or `app.json` changes.

```sh
pnpm add -g eas-cli
eas login                 # your Expo account
cd artifacts/mobile
eas init                  # links the app to your Expo account (first time only)
eas device:create         # open the link on your iPhone and install the profile
eas build --profile development --platform ios
```

When the build asks, sign in with your Apple ID and let EAS manage certificates. When it finishes, scan the QR code with the iPhone camera and install. Then turn on Developer Mode (Settings > Privacy & Security > Developer Mode) and restart the phone.

After that, `pnpm dev:mobile` and open Ball Boi on the phone. JavaScript changes reload instantly.

For the iOS Simulator instead of a phone: `eas build --profile development-simulator --platform ios`.

## Tests

```sh
pnpm test
pnpm typecheck
cd artifacts/ml-server && .venv/bin/python -m pytest tests
```

## Video storage

Match video goes to an S3-compatible bucket, configured with the `S3_*` variables in `.env`: SeaweedFS locally, Cloudflare R2 in production (`S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`). Video is input to shot analysis only and is never played back in the app.

## Known gaps

- **iOS push notifications** need an Expo account and EAS project ID. The rest of the app works without them.
- **`pnpm typecheck`**: shared libraries, the iOS app, and scripts pass. The API still has 98 type errors carried over from the original build (mostly loose request typing in `routes/ballBoi.ts`). Check that a change doesn't add new ones.

## Layout

- `artifacts/mobile`: Expo (SDK 58) iOS app
- `artifacts/api-server`: Express API (`/api/*`)
- `artifacts/ml-server`: FastAPI service for Ball Boi analysis
- `lib/db`: Postgres schema (Drizzle)
- `lib/api-spec`: OpenAPI spec; generates `lib/api-zod` and `lib/api-client-react`
- `scripts/migrations`: SQL migrations, applied automatically when the API starts
- `docs/`: product spec, design system, App Store checklist, backend notes
