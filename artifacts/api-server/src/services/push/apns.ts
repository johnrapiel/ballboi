// Live Activity pushes, straight to Apple (APNs). Expo's push service only
// sends ordinary notifications, so Live Activity starts, updates and ends go
// from here over HTTP/2 with the Apple key (appleKey.ts).
//
// A development build's tokens only work on Apple's sandbox server and a
// TestFlight or App Store build's only on production. A token's server isn't
// known up front, so production is tried first and sandbox on BadDeviceToken;
// the one that worked is remembered on the token.

import http2 from "node:http2";
import { logger } from "../../lib/logger";
import { appleJwt, appleKey, type AppleKey } from "./appleKey";

export type ApnsEnv = "production" | "sandbox";

const HOSTS: Record<ApnsEnv, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

export interface ApnsResult {
  ok: boolean;
  status: number;
  reason: string | null;
  env: ApnsEnv;
}

/** Tokens Apple says will never work again: drop them. */
export function tokenIsDead(r: ApnsResult): boolean {
  return r.status === 410 || r.reason === "Unregistered" || r.reason === "ExpiredToken";
}

const sessions = new Map<ApnsEnv, http2.ClientHttp2Session>();

function session(env: ApnsEnv): http2.ClientHttp2Session {
  const open = sessions.get(env);
  if (open && !open.closed && !open.destroyed) return open;
  const s = http2.connect(HOSTS[env]);
  s.on("error", (err) => logger.warn({ err, env }, "APNs connection error"));
  s.on("close", () => sessions.delete(env));
  // Don't keep the API process alive just for this connection.
  s.unref();
  sessions.set(env, s);
  return s;
}

function sendOnce(key: AppleKey, env: ApnsEnv, token: string, payload: unknown, priority: 5 | 10): Promise<ApnsResult> {
  return new Promise((resolve) => {
    let status = 0;
    let body = "";
    const req = session(env).request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${appleJwt(key)}`,
      "apns-topic": `${key.bundleId}.push-type.liveactivity`,
      "apns-push-type": "liveactivity",
      "apns-priority": String(priority),
      "content-type": "application/json",
    });
    req.setTimeout(10_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    const done = () => {
      let reason: string | null = null;
      try {
        reason = body ? ((JSON.parse(body) as { reason?: string }).reason ?? null) : null;
      } catch {
        reason = null;
      }
      resolve({ ok: status === 200, status, reason, env });
    };
    req.on("end", done);
    req.on("close", () => {
      if (!status) resolve({ ok: false, status: 0, reason: "NoResponse", env });
    });
    req.on("error", () => resolve({ ok: false, status: 0, reason: "NetworkError", env }));
    req.end(JSON.stringify(payload));
  });
}

let warnedNoKey = false;

/**
 * Sends one Live Activity push. `knownEnv` is the server that worked for this
 * token before. Returns null when the Apple key isn't set (logged once).
 */
export async function sendLiveActivityPush(
  token: string,
  payload: unknown,
  opts: { knownEnv?: ApnsEnv | null; priority?: 5 | 10 } = {},
): Promise<ApnsResult | null> {
  const key = appleKey();
  if (!key) {
    if (!warnedNoKey) logger.warn("APPLE_KEY_ID, APPLE_TEAM_ID or APPLE_PRIVATE_KEY missing: Live Activity pushes are off");
    warnedNoKey = true;
    return null;
  }
  const priority = opts.priority ?? 10;
  const first: ApnsEnv = opts.knownEnv ?? "production";
  const result = await sendOnce(key, first, token, payload, priority);
  if (!result.ok && !opts.knownEnv && result.reason === "BadDeviceToken") {
    return sendOnce(key, "sandbox", token, payload, priority);
  }
  return result;
}
