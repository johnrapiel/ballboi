// Adds the Google sign-in client IDs to the app config's `extra`, from the
// environment, as Clerk's Google guide asks (its hook reads them from `extra`).
// app.json holds everything else. Values come from the repo's .env (via
// `pnpm dev:mobile`) and, for EAS builds, from the EAS environment.
// They're public IDs, but never paste real values into this file.
import type { ConfigContext, ExpoConfig } from "expo/config";

const GOOGLE_KEYS = [
  "EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID",
  "EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID",
  "EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME",
] as const;

export default ({ config }: ConfigContext): ExpoConfig => {
  const google = Object.fromEntries(
    GOOGLE_KEYS.flatMap((key) => {
      const value = process.env[key]?.trim();
      return value ? [[key, value]] : [];
    }),
  );
  return { ...config, extra: { ...config.extra, ...google } } as ExpoConfig;
};
