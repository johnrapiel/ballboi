// A Ball Boi session's metadata is mostly the server's own: the ML callback
// token (it lets the analysis service post results for the session), upload
// ids, stat gates, retry state, who hid the card. The phone may set only the
// keys below when it starts a session, and those are the only keys any
// response sends back. One list both ways, so a new server key stays private
// without anyone remembering to hide it.

/**
 * Metadata keys the phone may send when it starts a session, and may see back.
 * - source: "ios".
 * - opponentAgreedAt: when the recorder confirmed "[Name] agreed to be filmed."
 *   for an opponent who isn't on Ball Boi (spec decisions 93 and 94; B10, B11).
 *   Such a match may enter the labeled test set, never training.
 */
export const PHONE_SESSION_KEYS = ["source", "opponentAgreedAt"] as const;

const MAX_SOURCE_LENGTH = 20;
/** A confirmation older than this (or in the future) isn't for this recording. */
const MAX_AGREED_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

/** A plausible ISO time for opponentAgreedAt, normalized, or null. */
export function agreedAt(v: unknown, now: Date = new Date()): string | null {
  if (typeof v !== "string" || v.length > 40) return null;
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return null;
  const age = now.getTime() - t.getTime();
  if (age > MAX_AGREED_AGE_MS || age < -MAX_CLOCK_SKEW_MS) return null;
  return t.toISOString();
}

type Row = Record<string, unknown>;

const asRow = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});

/** The phone's own metadata from a start request: plain short strings for the allowed keys, nothing else. */
export function phoneSessionMetadata(sent: unknown, now: Date = new Date()): Row {
  const m = asRow(sent);
  const out: Row = {};
  if (typeof m.source === "string" && m.source.length <= MAX_SOURCE_LENGTH) out.source = m.source;
  const agreed = agreedAt(m.opponentAgreedAt, now);
  if (agreed) out.opponentAgreedAt = agreed;
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
