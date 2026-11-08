// The Ball Boi Beta Footage Release (spec decisions 85, 92 and 96; B2, B9, B13).
//
// Testers use the same app as everyone. During the beta the app only exists
// on TestFlight, so a server setting on the private beta backend turns the
// release on; it's off by default and off for the App Store launch.
//
//   BETA_RELEASE_REQUIRED=true   ask for the release before recording
//   BETA_RELEASE_VERSION=1       bump when the release text changes: everyone
//                                agrees again before their next recording
//
// While the release is on, beta footage is kept until launch (B6; see
// videoRetention.ts).

export const BETA_RELEASE_URL = "https://ballboi.tennis/beta-release";

export interface BetaReleaseSetting {
  required: boolean;
  version: number;
}

export function readBetaRelease(env: NodeJS.ProcessEnv = process.env): BetaReleaseSetting {
  const raw = (env.BETA_RELEASE_REQUIRED ?? "").trim().toLowerCase();
  const required = raw === "true" || raw === "1" || raw === "yes" || raw === "on";
  const n = Number((env.BETA_RELEASE_VERSION ?? "").trim());
  const version = Number.isInteger(n) && n > 0 ? n : 1;
  return { required, version };
}

/** True when this person must agree (again) before recording. */
export function releaseNeeded(setting: BetaReleaseSetting, agreedVersion: number | null | undefined): boolean {
  if (!setting.required) return false;
  return agreedVersion == null || agreedVersion < setting.version;
}
