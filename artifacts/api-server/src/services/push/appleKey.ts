// The Apple key (.p8) the API signs with: Live Activity pushes (APNs) and
// DeviceCheck device bans. One key, made in the Apple Developer site with
// "Apple Push Notifications service" and "DeviceCheck" both ticked. It lives in
// Cloudflare secrets in production and in .env locally, never in the repo:
//
//   APPLE_KEY_ID       the key's 10-character ID
//   APPLE_TEAM_ID      the developer account's 10-character Team ID
//   APPLE_PRIVATE_KEY  the whole .p8 file, BEGIN and END lines included
//                      (one line with \n between lines works too)
//   APPLE_BUNDLE_ID    optional, defaults to tennis.ballboi
//
// Without them, Live Activity pushes and device bans are skipped and logged,
// and everything else carries on.

import crypto from "node:crypto";

export interface AppleKey {
  keyId: string;
  teamId: string;
  privateKey: string;
  bundleId: string;
}

export function appleKeyFrom(env: Record<string, string | undefined>): AppleKey | null {
  const keyId = env.APPLE_KEY_ID?.trim();
  const teamId = env.APPLE_TEAM_ID?.trim();
  const privateKey = env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!keyId || !teamId || !privateKey) return null;
  return { keyId, teamId, privateKey, bundleId: env.APPLE_BUNDLE_ID?.trim() || "tennis.ballboi" };
}

export function appleKey(): AppleKey | null {
  return appleKeyFrom(process.env);
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** An ES256 token Apple accepts for APNs and DeviceCheck: iss is the Team ID, kid the key. */
export function signAppleJwt(key: AppleKey, nowSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: key.keyId }));
  const claims = b64url(JSON.stringify({ iss: key.teamId, iat: nowSeconds }));
  const data = `${header}.${claims}`;
  const sig = crypto.sign("sha256", Buffer.from(data), { key: key.privateKey, dsaEncoding: "ieee-p1363" });
  return `${data}.${b64url(sig)}`;
}

/** Apple wants a token reused for 20 to 60 minutes: kept for 40. */
const REUSE_SECONDS = 40 * 60;
let cached: { keyId: string; token: string; at: number } | null = null;

export function appleJwt(key: AppleKey, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (cached && cached.keyId === key.keyId && nowSeconds - cached.at < REUSE_SECONDS) return cached.token;
  const token = signAppleJwt(key, nowSeconds);
  cached = { keyId: key.keyId, token, at: nowSeconds };
  return token;
}
