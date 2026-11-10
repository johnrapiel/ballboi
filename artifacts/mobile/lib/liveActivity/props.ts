// What the Live Activity shows (Wave 2, Session G; acceptance 31 to 35).
//
// The mounted phone builds these from its own state: the stage, the court
// status (the same words as its status chip), its battery, and the voice
// coach's latest caption, read from lib/coachLines.ts only (G11: captions
// live on the Live Activity, Apple Watch and a second phone, never the
// mounted screen). The API checks them and forwards them unchanged to the
// other player's phone, so both Lock Screens read the same.
//
// Every state is in words as well as color (acceptance 35). Nothing here
// mentions holding the screen (X2).
//
// Pure TypeScript, no React Native: tested in lib/__tests__/liveActivity.test.ts.
// Server copy of the shape: artifacts/api-server/src/services/push/liveActivityPlan.ts.

export const LIVE_ACTIVITY_NAME = "MatchActivity";

export type LiveStage = "setup" | "waiting" | "counting" | "paused" | "recording" | "interrupted" | "stopped";

export interface LiveProps {
  matchId: number;
  /** "John Rapiel vs. Sam Whitfield": reads right on either player's phone. */
  players: string;
  stage: LiveStage;
  /** The stage in words: "Setting up", "Recording starts in", "Recording". */
  status: string;
  /** The court, in the mounted phone's words: "Court locked", "Finding the court". */
  court: string;
  /** The mounted phone's battery, "Battery 65%", or null when unknown. */
  battery: string | null;
  /** The voice coach's latest line, word for word from the manifest. */
  caption: string | null;
  /** When capture starts (epoch ms), while counting down. */
  countdownTo: number | null;
  /** When the match started, adjusted for pauses (epoch ms), while recording. */
  recordingSince: number | null;
  canStart: boolean;
  canStop: boolean;
  startUrl: string;
  stopUrl: string;
  openUrl: string;
}

/** The record screen's phases, as far as the Live Activity cares. */
export type RecorderPhase =
  | "ready"
  | "armed"
  | "countdown"
  | "paused"
  | "recording"
  | "rejoining"
  | "interrupted"
  | "saving"
  | "deciding"
  | "courtFix"
  | "error";

export function liveStage(phase: RecorderPhase): LiveStage {
  switch (phase) {
    case "ready":
    case "error":
      return "setup";
    case "armed":
      return "waiting";
    case "countdown":
      return "counting";
    case "paused":
      return "paused";
    case "recording":
    case "rejoining":
      return "recording";
    case "interrupted":
      return "interrupted";
    default:
      return "stopped";
  }
}

export const STAGE_TEXT: Record<LiveStage, string> = {
  setup: "Setting up",
  // Until capture really starts, it says so (John, Nov 9).
  waiting: "Waiting for the court, not recording yet",
  counting: "Recording starts in",
  paused: "Countdown paused, not recording yet",
  recording: "Recording",
  interrupted: "Recording paused on the mounted phone",
  stopped: "Recording stopped",
};

/** "Battery 65%", in steps of 5 so the Live Activity isn't updated for every percent. Null when unknown. */
export function batteryText(level: number | null | undefined): string | null {
  if (level == null || !Number.isFinite(level) || level < 0) return null;
  const pct = Math.max(0, Math.min(100, Math.round((level * 100) / 5) * 5));
  return `Battery ${pct}%`;
}

export function liveLinks(matchId: number): Pick<LiveProps, "startUrl" | "stopUrl" | "openUrl"> {
  return {
    startUrl: `ballboi://live/${matchId}?action=start`,
    stopUrl: `ballboi://live/${matchId}?action=stop`,
    openUrl: `ballboi://live/${matchId}`,
  };
}

/** "John Rapiel vs. Sam Whitfield", or "You vs. Sam" when your name isn't known. */
export function playersLine(me: string | null | undefined, opponent: string): string {
  return `${me?.trim() || "You"} vs. ${opponent.trim() || "your opponent"}`;
}

export interface RecorderSnapshot {
  matchId: number;
  players: string;
  phase: RecorderPhase;
  court: string;
  batteryLevel: number | null;
  caption: string | null;
  /** When capture starts, while counting. */
  countdownTo: number | null;
  /** When the match started, adjusted for pauses, while recording. */
  recordingSince: number | null;
  /** Start can't happen from another phone: the opponent's filming box isn't ticked yet. */
  startBlocked: boolean;
}

export function buildLiveProps(s: RecorderSnapshot): LiveProps {
  const stage = liveStage(s.phase);
  return {
    matchId: s.matchId,
    players: s.players,
    stage,
    status: STAGE_TEXT[stage],
    court: stage === "stopped" ? "Saved on the mounted phone" : s.court,
    battery: batteryText(s.batteryLevel),
    caption: s.caption,
    countdownTo: stage === "counting" ? s.countdownTo : null,
    recordingSince: stage === "recording" ? s.recordingSince : null,
    // Start: only while setting up. It arms like Record (John, Nov 9), so once
    // armed there's nothing new for it to do and the button goes.
    canStart: !s.startBlocked && stage === "setup",
    // Stop: while recording, or paused after an interruption (it saves what's there).
    canStop: stage === "recording" || stage === "interrupted",
    ...liveLinks(s.matchId),
  };
}

/**
 * The recorder left the camera. Mid-match the recording was already saved by
 * the stop; before it, nothing was recorded.
 */
export function leftWithoutRecording(p: LiveProps): LiveProps {
  const recorded = p.stage === "recording" || p.stage === "interrupted" || p.stage === "stopped";
  return {
    ...p,
    stage: "stopped",
    status: recorded ? STAGE_TEXT.stopped : "Setup ended",
    court: recorded ? "Saved on the mounted phone" : "Nothing was recorded",
    countdownTo: null,
    recordingSince: null,
    canStart: false,
    canStop: false,
  };
}

/** Same thing on the Lock Screen? Then nothing needs sending. */
export function sameLive(a: LiveProps | null, b: LiveProps): boolean {
  if (!a) return false;
  return (Object.keys(b) as (keyof LiveProps)[]).every((k) => a[k] === b[k]);
}

export type LiveCommand = "start" | "stop";

/** The ?action= on a Live Activity link. */
export function liveAction(v: unknown): LiveCommand | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "start" || s === "stop" ? s : null;
}

/**
 * What the mounted phone does with Start or Stop from another phone.
 * - arm: armed like Record on the mounted phone (John, Nov 9). It waits for
 *   the court, or the Record anyway fallback, before line 19 and capture.
 *   Already armed, paused or counting: ignore, nothing new.
 * - stop: as if Stop was confirmed on the mounted phone (the other phone confirmed).
 * - finish: paused after an interruption, so it saves what was recorded.
 * - ignore: not possible right now (the Live Activity already says so).
 */
export function commandAction(phase: RecorderPhase, command: LiveCommand, startBlocked: boolean): "arm" | "stop" | "finish" | "ignore" {
  if (command === "start") {
    if (startBlocked) return "ignore";
    return phase === "ready" ? "arm" : "ignore";
  }
  if (phase === "recording" || phase === "rejoining") return "stop";
  if (phase === "interrupted") return "finish";
  return "ignore";
}

/** The second phone's words for what Stop does, for its confirm. */
export const STOP_CONFIRM_TITLE = "Stop recording?";
export const STOP_CONFIRM_BODY = "The mounted phone stops and saves the match.";
