// A Ball Boi session's metadata is mostly the server's own: the ML callback
// token (it lets the analysis service post results for the session), upload
// ids, stat gates, retry state, who hid the card. The phone may set only the
// keys below when it starts a session, and those are the only keys any
// response sends back. One list both ways, so a new server key stays private
// without anyone remembering to hide it.

/** Metadata keys the phone may send when it starts a session, and may see back. */
export const PHONE_SESSION_KEYS = ["source"] as const;

const MAX_SOURCE_LENGTH = 20;

type Row = Record<string, unknown>;

const asRow = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});

/** The phone's own metadata from a start request: plain short strings for the allowed keys, nothing else. */
export function phoneSessionMetadata(sent: unknown): Row {
  const m = asRow(sent);
  const out: Row = {};
  for (const key of PHONE_SESSION_KEYS) {
    const v = m[key];
    if (typeof v === "string" && v.length <= MAX_SOURCE_LENGTH) out[key] = v;
  }
  return out;
}

/** A session row as it goes to the app: metadata cut down to the phone's own keys. */
export function publicSession<T extends { metadata?: unknown }>(session: T): T;
export function publicSession<T extends { metadata?: unknown }>(session: T | null): T | null;
export function publicSession<T extends { metadata?: unknown }>(session: T | null): T | null {
  if (!session) return null;
  if (!("metadata" in session) || session.metadata == null) return session;
  const m = asRow(session.metadata);
  const kept: Row = {};
  for (const key of PHONE_SESSION_KEYS) if (key in m) kept[key] = m[key];
  return { ...session, metadata: kept };
}
