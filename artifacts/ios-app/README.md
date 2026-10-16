# Ball Boi for iOS

Expo (SDK 58) app that shares the API, generated client and types with the web app.

## First run

```sh
pnpm install
cd artifacts/ios-app
pnpm align                 # expo install --fix: snaps native deps to SDK 58
cp .env.example .env       # add your Clerk publishable key
pnpm start                 # press i for the iOS simulator
```

The camera needs a real device. Build a dev client with `eas build --profile development` or run `pnpm ios` with a phone plugged in.

## Clerk setup

In the Clerk dashboard, turn on:
- **Email code** (passwordless)
- **Google**
- **Apple** (required by App Store guideline 4.8 because Google is offered)

Add `ballboi://sso-callback` as an allowed redirect URL for native apps.

## Shipping

```sh
pnpm build:ios     # EAS builds with the latest Xcode (26+), which App Store Connect requires
pnpm submit:ios
```

Track release readiness in `docs/app-store-checklist.md`.

## Accessibility rules for this app

- Colors come from `src/theme/tokens.ts`. Every pair is listed in `CONTRAST_PAIRS` and must clear 4.5:1 (3:1 for focus and non-text).
- Never set `allowFontScaling={false}`. Dynamic Type stays on.
- Interactive elements are at least 44×44pt (`MIN_TAP`) and carry an `accessibilityLabel`.
- Text over video sits on a 60% black scrim.
