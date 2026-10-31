// Which of a player's matches Ball Boi can record right now.
//
// Spec (Ball Boi > Recording): "Every recording starts from a match." The Ball
// Boi tab's "Record a match" lists today's matches first, then Quick match.

export interface MatchRow {
  id: number;
  leagueId: number | null;
  player1Id: number;
  player2Id: number;
  player3Id: number | null;
  player4Id: number | null;
  status: string;
  scheduledAt: string | null;
  location: string | null;
}

export interface RecordableMatch {
  id: number;
  scheduledAt: string | null;
  location: string | null;
  leagueId: number | null;
  leagueName: string | null;
  format: "singles" | "doubles";
  /** The other side: "Alex Kim", or "Alex Kim and Sam Lee" in doubles. */
  opponentName: string;
  /** Your doubles partner, when there is one. */
  partnerName: string | null;
}

/** Statuses that mean the match is over or off. */
const DONE = new Set(["completed", "cancelled", "canceled", "voided", "forfeit"]);

/** True when the match is scheduled inside [from, to) and hasn't been played. */
export function isRecordableToday(m: MatchRow, from: Date, to: Date): boolean {
  if (DONE.has(m.status)) return false;
  if (!m.scheduledAt) return false;
  const at = new Date(m.scheduledAt).getTime();
  if (Number.isNaN(at)) return false;
  return at >= from.getTime() && at < to.getTime();
}

/**
 * Describes a match from the viewer's side. `myPlayerIds` are every player row
 * linked to the viewer (one account can have one per league).
 */
export function toRecordableMatch(
  m: MatchRow,
  myPlayerIds: number[],
  names: Record<number, string>,
  leagueNames: Record<number, string>,
): RecordableMatch | null {
  const mine = new Set(myPlayerIds);
  const doubles = m.player3Id != null && m.player4Id != null;
  // Sides: player1 + player3 against player2 + player4.
  const sideA = [m.player1Id, m.player3Id].filter((id): id is number => id != null);
  const sideB = [m.player2Id, m.player4Id].filter((id): id is number => id != null);
  const onA = sideA.some((id) => mine.has(id));
  const onB = sideB.some((id) => mine.has(id));
  if (!onA && !onB) return null;
  const mySide = onA ? sideA : sideB;
  const theirSide = onA ? sideB : sideA;
  const name = (id: number) => names[id] ?? "Opponent";
  const partner = mySide.find((id) => !mine.has(id));
  return {
    id: m.id,
    scheduledAt: m.scheduledAt,
    location: m.location,
    leagueId: m.leagueId,
    leagueName: m.leagueId != null ? (leagueNames[m.leagueId] ?? null) : null,
    format: doubles ? "doubles" : "singles",
    opponentName: theirSide.map(name).join(" and "),
    partnerName: doubles && partner != null ? name(partner) : null,
  };
}

/** Earliest first; matches with no time go last. */
export function byScheduledTime(a: RecordableMatch, b: RecordableMatch): number {
  const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity;
  const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity;
  return ta - tb;
}

/** Reads a `from`/`to` query value as a date, or null when it isn't one. */
export function parseWhen(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** What the Ball Boi tab's processing card says about a server recording. */
export type RecordingStage = "uploading" | "analyzing" | "ready" | "failed";

/**
 * Maps a session's status to the card's stage. "recording" on the server means
 * the phone made the session but the upload hasn't finished.
 */
export function recordingStage(status: string, processingStatus: string): RecordingStage {
  if (status === "completed" || processingStatus === "completed") return "ready";
  if (status === "failed" || processingStatus === "failed") return "failed";
  if (status === "processing" || processingStatus === "processing") return "analyzing";
  return "uploading";
}
