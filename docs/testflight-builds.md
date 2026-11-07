# Automatic TestFlight builds

After setup, every merge to `main` that touches the iOS app puts the latest Ball Boi on John's phone through TestFlight. No terminal needed.

- **Native change** (new package, `app.json`, permissions): EAS builds a new app in the cloud and sends it to TestFlight. Takes about 20 to 40 minutes.
- **App code only**: no rebuild. EAS sends an over-the-air update to the TestFlight app, which picks it up the next time it opens (close and reopen to apply). Takes a few minutes.

Every build and update points at **staging**, never production. Testers stay off until all build waves are done; only internal testers (John) get these builds, and internal TestFlight builds skip Apple's beta review.

The workflow lives in `artifacts/mobile/.eas/workflows/testflight-staging.yml`. Merges that only touch the API, ML server or docs don't trigger it.

Local development doesn't change: keep using `pnpm dev:mobile`.

## One-time setup (John)

Nothing runs until step 6, so the PR is safe to merge before setup is done.

1. **Host the staging API.** The TestFlight app needs an API it can reach away from home. See `docs/staging-api.md`.
2. **Add staging values to EAS.** expo.dev > ballboi > Environment variables, environment **preview**:
   - `EXPO_PUBLIC_API_URL` (the staging API URL)
   - `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME` (once Google sign-in is set up)
   These are public IDs, so "Plain text" or "Sensitive" visibility is fine. Never put secret keys here.
3. **App Store Connect app record**: done Nov 6, 2026 (Ball Boi, App Store ID 6831844206, set as `ascAppId` in `eas.json`).
4. **Apple credentials in EAS**: the distribution certificate and provisioning profile were already in EAS (Oct 2026). The App Store Connect API key "Expo EAS Ball Boi" (Admin) is uploaded under expo.dev > ballboi > Credentials > tennis.ballboi, so builds and TestFlight uploads run without an Apple login. No terminal step needed.
5. **Add yourself as an internal tester.** App Store Connect > Ball Boi > TestFlight > Internal Testing. Install the TestFlight app on your iPhone.
6. **Connect GitHub to EAS.** expo.dev > ballboi > Project settings > GitHub: install the Expo GitHub app, connect `johnrapiel/ballboi`, and set the base directory to `artifacts/mobile`. From here on, merges run the workflow.

Also: this PR adds `expo-updates`, a native package, so the development build on your phone needs rebuilding once (`eas build --profile development --platform ios`). Do it together with the Wave 1 dev build.

## Limits on Expo's free plan

The free plan includes 15 iOS builds and 60 minutes of workflow time a month. Skipping the build when only app code changed, ignoring API and docs merges, and building only the newest merge when several land close together keeps most months inside that. Check usage at expo.dev > Billing. If a busy month runs out, new builds stop until the limits reset the next month; the app already on your phone keeps working. The $19/month Starter plan raises the limits if that becomes a problem.

## If something fails

Open expo.dev > ballboi > Workflows to see which step failed and why. Ask Claude to read the log and fix it.
