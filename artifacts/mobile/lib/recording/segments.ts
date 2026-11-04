// A match recording in pieces (Wave 1 review: calls and interruptions).
//
// iOS ends a camera recording when a call is answered, the phone locks or
// the player switches apps, and briefly while a call rings. The file up to
// that moment is kept. Each piece is a "segment"; the match is all of them,
// joined on the server in order. Pure helpers only: no React Native here, so
// lib/__tests__ can run them in Node.

export interface RecordedSegment {
  uri: string;
  sizeBytes: number;
  durationSeconds: number;
  /** When this piece started recording (ISO). */
  startedAt: string;
}

export interface JoinedRecording {
  durationSeconds: number;
  sizeBytes: number;
  /** When the match recording started: the first piece's start. */
  recordedAt: string;
  segmentCount: number;
}

/** Totals for the whole match. The pieces stay in the order they were recorded. */
export function joinSegments(segments: RecordedSegment[], now: Date = new Date()): JoinedRecording {
  const ordered = [...segments].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  return {
    durationSeconds: ordered.reduce((s, x) => s + Math.max(0, x.durationSeconds), 0),
    sizeBytes: ordered.reduce((s, x) => s + Math.max(0, x.sizeBytes), 0),
    recordedAt: ordered[0]?.startedAt ?? now.toISOString(),
    segmentCount: ordered.length,
  };
}

/** Seconds left under the 4-hour cap once these pieces are counted. Never below 0. */
export function remainingSeconds(segments: Pick<RecordedSegment, "durationSeconds">[], maxSeconds: number): number {
  const used = segments.reduce((s, x) => s + Math.max(0, x.durationSeconds), 0);
  return Math.max(0, Math.floor(maxSeconds - used));
}

/** Time on the recording clock: finished pieces plus the one running now. */
export function elapsedSeconds(
  segments: Pick<RecordedSegment, "durationSeconds">[],
  currentStartedAtMs: number | null,
  nowMs: number,
): number {
  const done = segments.reduce((s, x) => s + Math.max(0, x.durationSeconds), 0);
  const running = currentStartedAtMs === null ? 0 : Math.max(0, Math.round((nowMs - currentStartedAtMs) / 1000));
  return done + running;
}

/** Every file a queued recording has on the phone, first piece first. */
export function recordingFiles(rec: { uri: string; segments?: { uri: string }[] | null }): string[] {
  if (rec.segments && rec.segments.length > 0) return rec.segments.map((s) => s.uri);
  return [rec.uri];
}

/** Why the camera stopped writing a piece. */
export type SegmentEnd =
  /** The player stopped, or the safety cap or 4-hour limit did. The match is done. */
  | "stopped"
  /** The app stayed open (a call rang and wasn't answered): start the next piece straight away. */
  | "rejoin"
  /** The app went to the background (answered call, lock, app switch): offer Resume recording. */
  | "interrupted";

export function segmentEnd(input: { stopRequested: boolean; backgrounded: boolean; atCap: boolean }): SegmentEnd {
  if (input.stopRequested || input.atCap) return "stopped";
  return input.backgrounded ? "interrupted" : "rejoin";
}

/** How long to keep trying to restart the camera after a ring before offering Resume instead. */
export const REJOIN_GIVE_UP_MS = 2 * 60 * 1000;
/** Gap between restart attempts while a call is ringing. */
export const REJOIN_RETRY_MS = 1000;
