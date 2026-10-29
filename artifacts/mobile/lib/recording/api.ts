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
