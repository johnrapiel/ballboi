// A recording's metadata sidecar (shot tracker test plan, decision T5): what
// the phone, camera and court were doing while it filmed, so every miss in
// the eval can be traced. The phone writes it while recording and sends it
// next to the video; the server keeps one JSON file per session in storage at
// sidecars/match-<matchId>/session-<sessionId>.json and its path in the
// session's metadata (sidecarPath).
//
// The server checks it before storing:
// - version 1 only;
// - known sections only, so nothing new slips in unreviewed;
// - anything that looks like a location or a name is dropped, at any depth
//   (the release promises no location and no names beyond the session's);
// - at most MAX_SIDECAR_BYTES once cleaned (the phone caps its lists well
//   under that).
// The match and session ids are the server's, never the phone's.

export const SIDECAR_VERSION = 1;
export const MAX_SIDECAR_BYTES = 96 * 1024;

/** The sections a version 1 sidecar may have. */
export const SIDECAR_SECTIONS = [
  "sidecarVersion",
  "startedAt",
  "captureStartedAt",
  "stoppedAt",
  "stopReason",
  "complete",
  "device",
  "capture",
  "courtLock",
  "movement",
  "health",
  "conditions",
  "missing",
] as const;

/** Keys never stored, at any depth. */
const PRIVATE_KEY = /^(lat|latitude|lng|lon|long|longitude|location|coords|coordinates|gps|address|name|firstname|lastname|fullname|email|phone|username|playername|opponentname)$/i;

/** Deepest nesting kept. The real shape is 4 levels. */
const MAX_DEPTH = 6;

export type SidecarCheck = { ok: true; sidecar: Record<string, unknown>; json: string } | { ok: false; error: string };

function clean(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PRIVATE_KEY.test(k)) continue;
      const c = clean(v, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return null;
}

/** Checks and cleans a sidecar from the phone. Pure, so the rules are easy to test. */
export function checkSidecar(body: unknown, ids: { matchId: number; sessionId: number }): SidecarCheck {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send the sidecar as a JSON object." };
  const sent = body as Record<string, unknown>;
  if (sent.sidecarVersion !== SIDECAR_VERSION) return { ok: false, error: "Only sidecar version 1 is accepted." };
  const sidecar: Record<string, unknown> = {};
  for (const key of SIDECAR_SECTIONS) {
    if (key in sent) sidecar[key] = clean(sent[key], 1);
  }
  sidecar.matchId = ids.matchId;
  sidecar.sessionId = ids.sessionId;
  sidecar.receivedAt = new Date().toISOString();
  const json = JSON.stringify(sidecar);
  if (Buffer.byteLength(json, "utf8") > MAX_SIDECAR_BYTES) return { ok: false, error: "The sidecar is too big." };
  return { ok: true, sidecar, json };
}

/** Where a session's sidecar is stored. */
export function sidecarObjectPath(matchId: number, sessionId: number): string {
  return `/objects/sidecars/match-${matchId}/session-${sessionId}.json`;
}
