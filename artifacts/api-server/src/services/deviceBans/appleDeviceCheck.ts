// Apple's DeviceCheck server: reads and sets the two bits Apple keeps for each
// iPhone for Ball Boi. Signed with the same Apple key as Live Activity pushes
// (services/push/appleKey.ts; DeviceCheck must be ticked on the key).
//
// A development build's tokens only work with Apple's development server, a
// TestFlight or App Store build's only with production. Production is tried
// first and development when Apple says the token is bad; the one that worked
// is remembered with the token.

import crypto from "node:crypto";
import { appleJwt, appleKey } from "../push/appleKey";

export type AppleEnv = "production" | "development";

const HOSTS: Record<AppleEnv, string> = {
  production: "https://api.devicecheck.apple.com",
  development: "https://api.development.devicecheck.apple.com",
};

export interface TwoBits {
  bit0: boolean;
  bit1: boolean;
}

export type BitsResult = { ok: true; bits: TwoBits; env: AppleEnv } | { ok: false; status: number; reason: string };

type Fetch = typeof fetch;

async function call(env: AppleEnv, path: string, body: object, f: Fetch): Promise<Response | null> {
  const key = appleKey();
  if (!key) return null;
  return f(`${HOSTS[env]}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${appleJwt(key)}`, "content-type": "application/json" },
    body: JSON.stringify({ ...body, transaction_id: crypto.randomUUID(), timestamp: Date.now() }),
    signal: AbortSignal.timeout(10_000),
  });
}

/** Apple answers 200 with text when the bits were never set: both false. */
export function parseBits(text: string): TwoBits {
  try {
    const j = JSON.parse(text) as { bit0?: unknown; bit1?: unknown };
    return { bit0: j.bit0 === true, bit1: j.bit1 === true };
  } catch {
    return { bit0: false, bit1: false };
  }
}

async function withFallback(
  path: string,
  body: object,
  knownEnv: AppleEnv | null,
  f: Fetch,
  read: (res: Response) => Promise<TwoBits>,
): Promise<BitsResult> {
  const order: AppleEnv[] = knownEnv ? [knownEnv] : ["production", "development"];
  let last: BitsResult = { ok: false, status: 0, reason: "No Apple key" };
  for (const env of order) {
    let res: Response | null;
    try {
      res = await call(env, path, body, f);
    } catch {
      return { ok: false, status: 0, reason: "Couldn't reach Apple" };
    }
    if (!res) return last;
    if (res.ok) return { ok: true, bits: await read(res), env };
    last = { ok: false, status: res.status, reason: (await res.text().catch(() => "")).slice(0, 200) };
    // Only a bad token means "try the other server".
    if (res.status !== 400) return last;
  }
  return last;
}

export function queryBits(token: string, knownEnv: AppleEnv | null, f: Fetch = fetch): Promise<BitsResult> {
  return withFallback("/v1/query_two_bits", { device_token: token }, knownEnv, f, async (res) => parseBits(await res.text()));
}

export function updateBits(token: string, bits: TwoBits, knownEnv: AppleEnv | null, f: Fetch = fetch): Promise<BitsResult> {
  return withFallback("/v1/update_two_bits", { device_token: token, bit0: bits.bit0, bit1: bits.bit1 }, knownEnv, f, async () => bits);
}

export function deviceCheckConfigured(): boolean {
  return appleKey() !== null;
}
