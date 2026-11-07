# Automatic TestFlight builds

After setup, every merge to `main` that touches the iOS app puts the latest Ball Boi on John's phone and on every beta player's phone through TestFlight. No terminal needed.

- **Native change** (new package, `app.json`, permissions): EAS builds a new app in the cloud, uploads it to TestFlight and adds it to the external **Beta players** group. Internal testers (John) get it too. Takes about 20 to 40 minutes for the build, plus Apple's processing (usually 5 to 15 minutes).
- **App code only**: no rebuild. EAS sends an over-the-air update to the TestFlight app, which picks it up the next time it opens (close and reopen to apply). Takes a few minutes.
- **Something failed**: EAS emails John with a link to the failed step. Nothing reaches testers from a failed run, so they keep the last good build and update.

Every build and update points at **staging** (the private staging API), never production.

### Do beta players get the over-the-air updates?

Yes, automatically. The update goes to the app's `staging` channel, and every copy of the TestFlight build listens to that channel, whether it was installed by an internal or an external tester. Apple's beta review only applies to new builds, not to these updates. Testers get each update the next time they close and reopen Ball Boi. An update only reaches builds with the same native code, so after a native change, testers need the new TestFlight build first (TestFlight installs it automatically if they have automatic updates on, or they tap Update in TestFlight).

Because testers get every merge to `main` within minutes, half-built features must stay hidden in the app before they merge.

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
5. **Add yourself as an internal tester.** App Store Connect > Ball Boi > TestFlight > Internal Testing. Install the TestFlight app on your iPhone. (You need an internal group before Apple lets you make an external one.)
6. **Connect GitHub to EAS.** expo.dev > ballboi > Project settings > GitHub: install the Expo GitHub app, connect `johnrapiel/ballboi`, and set the base directory to `artifacts/mobile`. From here on, merges run the workflow.

Then the beta player steps in the next section, before the first beta build.

Also: this PR adds `expo-updates`, a native package, so the development build on your phone needs rebuilding once (`eas build --profile development --platform ios`). Do it together with the Wave 1 dev build.

## Beta players: one-time setup (John)

Cost: free. TestFlight external testing comes with the Apple Developer Program membership you already pay for, up to 10,000 testers. No new Expo plan or service is needed.

Do steps 1 to 4 once, before the first native build that should reach testers. If a build runs before the group exists, the TestFlight step fails, John gets the failure email, and nothing else breaks; rerun it after setup (expo.dev > ballboi > Workflows > the failed run > Rerun).

### 1. Check the App Store Connect API key (no new key needed)

The pipeline uses the key already saved in EAS: **"Expo EAS Ball Boi"**, role **Admin**. Admin is allowed to manage external testers and submit for beta review, so nothing to create or paste.

To check it's still there: expo.dev > ballboi > Credentials > iOS > tennis.ballboi > App Store Connect API Key. It should show "Expo EAS Ball Boi".

Only if it's missing or was revoked, make a new one:
1. appstoreconnect.apple.com > Users and Access > Integrations > App Store Connect API > Team Keys > the **+** button.
2. Name: `Expo EAS Ball Boi`. Access: **Admin**. Generate.
3. Download the `.p8` file (Apple only lets you download it once). Note the **Key ID** on that row and the **Issuer ID** above the table.
4. expo.dev > ballboi > Credentials > iOS > tennis.ballboi > App Store Connect API Key > Add a new key. Upload the `.p8` file and enter the Key ID and Issuer ID there.
5. Delete the `.p8` from your Downloads folder. Never paste the key or its contents into a chat, an email, the repo or GitHub.

### 2. Fill in Test Information (needed before Apple's beta review)

App Store Connect > Apps > Ball Boi > TestFlight > Test Information (left side, under General Information):
1. **Beta App Description**: what Ball Boi is and what testers should try (for example: "Ball Boi records your singles match from the fence and saves it for shot analysis. Please record a full match and tell us what went wrong.").
2. **Feedback Email**: `support@ballboi.tennis`.
3. **Marketing URL** and **Privacy Policy URL**: `https://ballboi.tennis` and `https://ballboi.tennis/privacy`.
4. **Beta App Review Information**: your name, phone and email as the contact. Turn on **Sign-in required** and give Apple a working sign-in for the staging app (the reviewer demo account in `docs/app-store-connect.md` once it exists). Add a note: "Recording needs a real court. Camera and microphone are used only to detect shots."
5. Save.

### 3. Create the "Beta players" group

App Store Connect > Apps > Ball Boi > TestFlight > the **+** next to External Testing (left side) > name it exactly **Beta players** (capital B, lowercase p; the pipeline looks for this name) > Create. Leave builds empty: the pipeline adds them.

### 4. Apple's one-time beta review

The first build that reaches the group is sent to Apple's beta review automatically. It usually takes about a day. You don't need to click anything, but you can watch it at TestFlight > Beta players > Builds (status "Waiting for Review", then "Testing"). Apple emails you when it's approved or if they have questions.

- The review repeats only when the app's version number changes (today 1.0.0). New builds of the same version usually go straight to testers.
- If Apple rejects a build, testers keep the build they have. Read the note in App Store Connect > Resolution Center, and ask Claude to help fix it.
- While a review is pending, a new build can't be submitted on top of it. If a merge lands then, the TestFlight step may fail and John gets the email; rerun it once the review clears.

## Invite a beta player

Only after the first build is approved (step 4):

1. App Store Connect > Apps > Ball Boi > TestFlight > **Beta players** > Testers > the **+** button > **Add New Testers**.
2. Enter their first name, last name and email address. Add.
3. Apple emails them an invite from TestFlight right away. There's no limit on how many you add at once, and they don't need an Apple developer account.

What the tester does:
1. On their iPhone, install **TestFlight** from the App Store.
2. Open Apple's invite email on the iPhone and tap **View in TestFlight** (or enter the code from the email in TestFlight > Redeem).
3. Tap **Accept**, then **Install**. Ball Boi appears on their home screen.
4. In TestFlight > Ball Boi, leave **Automatic Updates** on so new builds arrive without tapping.

To remove a tester: Beta players > Testers > select them > Remove. They stop getting new builds and lose access to Ball Boi in TestFlight.

Every TestFlight build expires 90 days after upload. Testers keep getting new ones as long as merges keep going out.

## Limits on Expo's free plan

The free plan includes 15 iOS builds and 60 minutes of workflow time a month. Skipping the build when only app code changed, ignoring API and docs merges, and building only the newest merge when several land close together keeps most months inside that. Check usage at expo.dev > Billing. The TestFlight step waits for Apple to finish processing each build (usually 5 to 15 minutes, at most 30), which may count toward the workflow minutes; check Billing after the first beta build. If a busy month runs out, new builds stop until the limits reset the next month; the app already on your phone keeps working. The $19/month Starter plan raises the limits if that becomes a problem.

## If something fails

When any step fails, EAS emails John with the change and a link to the failed run. Testers keep the last good build and update: a failed build never reaches TestFlight, and a failed update is never published.

To turn the email on, add it once: expo.dev > ballboi > Environment variables > Add variable. Name `BUILD_ALERT_EMAIL`, value your email address, environment **preview** only, visibility **Sensitive**. It stays out of the public repo, and it isn't built into the app because it doesn't start with `EXPO_PUBLIC_`.

Open expo.dev > ballboi > Workflows to see which step failed and why. Ask Claude to read the log and fix it.
