// Ball Boi recording endpoints that aren't in the generated client.
// Server: artifacts/api-server/src/routes/recording.ts.

import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";

import { apiErrorMessage, apiFetch } from "@/lib/api";

export interface RecordableMatch {
  id: number;
  scheduledAt: string | null;
  location: string | null;
  leagueId: number | null;
  leagueName: string | null;
  format: "singles" | "doubles";
  opponentName: string;
  partnerName: string | null;
}

/** Start and end of the phone's local day. */
export function localDay(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { from, to };
}

export const todaysMatchesKey = ["recording", "todays-matches"] as const;

/** The signed-in player's unplayed matches today, earliest first. */
export function useTodaysMatches() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: todaysMatchesKey,
    queryFn: async (): Promise<RecordableMatch[]> => {
      const { from, to } = localDay();
      const qs = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
      const res = await apiFetch(`/api/recording/todays-matches?${qs}`, getToken);
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't load today's matches."));
      return (await res.json()) as RecordableMatch[];
    },
  });
}

/** "6:00 PM", or null when there's no time. */
export function matchTime(scheduledAt: string | null): string | null {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Shown wherever Ball Boi is unavailable on a doubles match (spec wording). */
export const DOUBLES_MESSAGE = "Ball Boi analyzes singles for now. Doubles is coming.";

const loggedDoublesViews = new Set<number>();

/** Counts a view of the doubles disabled state. Once per match per app launch; never throws. */
export async function logDoublesView(matchId: number, getToken: () => Promise<string | null>) {
  if (loggedDoublesViews.has(matchId)) return;
  loggedDoublesViews.add(matchId);
  try {
    await apiFetch("/api/recording/doubles-views", getToken, { method: "POST", body: JSON.stringify({ matchId }) });
  } catch {
    // A missed count isn't worth bothering anyone about.
  }
}

export type RecordingStage = "uploading" | "analyzing" | "ready" | "failed";

export interface ServerRecording {
  sessionId: number;
  matchId: number;
  opponentName: string;
  recordedAt: string;
  stage: RecordingStage;
  scoreEntered: boolean;
}

export const recordingsKey = ["recording", "sessions"] as const;

/** Your recent recordings on the server. Checks again every 30 s while any is analyzing. */
export function useServerRecordings() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: recordingsKey,
    queryFn: async (): Promise<ServerRecording[]> => {
      const res = await apiFetch("/api/recording/sessions", getToken);
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't load your recordings."));
      return (await res.json()) as ServerRecording[];
    },
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.stage === "uploading" || r.stage === "analyzing") ? 30_000 : false,
  });
}

/** "Today", "Yesterday", or "Oct 21". */
export function recordedDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export interface RecordingConsent {
  consented: boolean;
  consentedAt: string | null;
  trainingEnabled: boolean;
}

export const consentKey = ["recording", "consent"] as const;

/** Has this account agreed to the first-recording screen, and is training on? */
export function useRecordingConsent() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: consentKey,
    queryFn: async (): Promise<RecordingConsent> => {
      const res = await apiFetch("/api/recording/consent", getToken);
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't load your recording settings."));
      return (await res.json()) as RecordingConsent;
    },
    staleTime: Infinity,
  });
}

/** Saves the first-recording screen's answer. */
export async function saveRecordingConsent(
  trainingEnabled: boolean,
  getToken: () => Promise<string | null>,
): Promise<RecordingConsent> {
  const res = await apiFetch("/api/recording/consent", getToken, {
    method: "POST",
    body: JSON.stringify({ trainingEnabled }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't save your choice. Try again."));
  return (await res.json()) as RecordingConsent;
}

/**
 * The training toggle on its own (Settings > Privacy).
 * Hand-off to Session H: bind the Settings switch to this and useRecordingConsent().
 */
export async function saveTrainingEnabled(
  trainingEnabled: boolean,
  getToken: () => Promise<string | null>,
): Promise<RecordingConsent> {
  const res = await apiFetch("/api/recording/training", getToken, {
    method: "PUT",
    body: JSON.stringify({ trainingEnabled }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't save your choice. Try again."));
  return (await res.json()) as RecordingConsent;
}

export interface Opponent {
  playerId: number;
  name: string;
}

/** League mates and past opponents you can pick for a Quick match. */
export function useQuickMatchOpponents() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["recording", "opponents"],
    queryFn: async (): Promise<Opponent[]> => {
      const res = await apiFetch("/api/recording/opponents", getToken);
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't load players."));
      return (await res.json()) as Opponent[];
    },
  });
}

export interface QuickMatchCreated {
  matchId: number;
  opponentName: string;
  /** Set when the opponent isn't on Ball Boi: share this link with them. */
  invite: { code: string; url: string } | null;
}

export async function createQuickMatch(
  opponent: { opponentPlayerId: number } | { opponentName: string },
  getToken: () => Promise<string | null>,
): Promise<QuickMatchCreated> {
  const res = await apiFetch("/api/recording/quick-matches", getToken, {
    method: "POST",
    body: JSON.stringify({ format: "singles", ...opponent }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't start the match. Try again."));
  return (await res.json()) as QuickMatchCreated;
}

export interface MatchInvite {
  code: string;
  recorderName: string;
  yourName: string;
  recordedAt: string;
  claimed: boolean;
  claimedByYou: boolean;
  isYourInvite: boolean;
}

export function useMatchInvite(code: string, enabled: boolean) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["recording", "invite", code],
    enabled,
    queryFn: async (): Promise<MatchInvite> => {
      const res = await apiFetch(`/api/recording/invites/${encodeURIComponent(code)}`, getToken);
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't load this invite."));
      return (await res.json()) as MatchInvite;
    },
  });
}

export async function claimMatchInvite(
  code: string,
  trainingEnabled: boolean,
  getToken: () => Promise<string | null>,
): Promise<{ matchId: number }> {
  const res = await apiFetch(`/api/recording/invites/${encodeURIComponent(code)}/claim`, getToken, {
    method: "POST",
    body: JSON.stringify({ trainingEnabled }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't add the match. Try again."));
  return (await res.json()) as { matchId: number };
}

/** A set as typed on the score prompt, from your side. */
export interface SetEntry {
  mine: string;
  theirs: string;
  /** Loser's points in a 7-6 tiebreak, when played. */
  tiebreak: string;
}

/** True when a set is 7-6 either way, so it had a tiebreak. */
export function isTiebreakSet(set: SetEntry): boolean {
  const a = Number(set.mine);
  const b = Number(set.theirs);
  return (a === 7 && b === 6) || (a === 6 && b === 7);
}

/** "6-3, 7-6(4)" from the sets typed so far. Blank sets are skipped. */
export function scoreString(sets: SetEntry[]): string {
  return sets
    .filter((s) => s.mine.trim() !== "" && s.theirs.trim() !== "")
    .map((s) => {
      const tb = isTiebreakSet(s) && s.tiebreak.trim() !== "" ? `(${Number(s.tiebreak)})` : "";
      return `${Number(s.mine)}-${Number(s.theirs)}${tb}`;
    })
    .join(", ");
}

/** Start of the 409 message both score routes send when a score is already in. */
export const ALREADY_ENTERED = "A score is already in for this match.";

/**
 * Posts the score from your side. League matches go to the league's score
 * route (Session C: first score stands, standings and grace week); Quick
 * matches to the recording route, which never touches standings.
 */
export async function submitScore(
  target: { matchId: number; leagueId: number | null },
  score: string,
  getToken: () => Promise<string | null>,
): Promise<{ ok: true } | { ok: false; error: string; alreadyEntered: boolean }> {
  const path =
    target.leagueId != null
      ? `/api/leagues/${target.leagueId}/matches/${target.matchId}/score`
      : `/api/recording/quick-matches/${target.matchId}/score`;
  const res = await apiFetch(path, getToken, { method: "POST", body: JSON.stringify({ score }) });
  if (res.ok) return { ok: true };
  const error = await apiErrorMessage(res, "Couldn't save the score. Try again.");
  // The league route also answers 409 for a cancelled match, a round that
  // hasn't opened, or a grace week that's over. Only "already in" means the
  // opponent beat you to it; the rest show their own message.
  return { ok: false, alreadyEntered: res.status === 409 && error.startsWith(ALREADY_ENTERED), error };
}
