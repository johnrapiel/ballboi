// Live Activity rules (Wave 2, Session G; acceptance 31 to 35; decision 129).
// Pure, so they're tested without a database or Apple.
//
// - The mounted phone builds what the Live Activity shows (the props) from the
//   voice coach's manifest, so the server only checks and forwards them.
// - Who gets it on their own phone (G7): every other player on the match with
//   a Ball Boi account. A Quick match stranger's stand-in has no account until
//   they answer Yes, so they get it only then (acceptance 33). Placeholders
//   never do.
// - Start and Stop from another phone wait on the session until the mounted
//   phone picks them up. Either player has full controls (acceptance 32).

export const LIVE_ACTIVITY_NAME = "MatchActivity";

export type LiveStage = "setup" | "waiting" | "counting" | "paused" | "recording" | "interrupted" | "stopped";
const STAGES: LiveStage[] = ["setup", "waiting", "counting", "paused", "recording", "interrupted", "stopped"];

export interface LiveProps {
  matchId: number;
  players: string;
  stage: LiveStage;
  status: string;
  court: string;
  battery: string | null;
  caption: string | null;
  countdownTo: number | null;
  recordingSince: number | null;
  canStart: boolean;
  canStop: boolean;
  startUrl: string;
  stopUrl: string;
  openUrl: string;
}

export type LiveCommand = "start" | "stop";

export function isLiveCommand(v: unknown): v is LiveCommand {
  return v === "start" || v === "stop";
}

const MAX_TEXT = 200;

function text(v: unknown, max = MAX_TEXT): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
}

function time(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/** The deep links the Live Activity opens. Built here too, so a phone can't point them elsewhere. */
export function liveLinks(matchId: number): Pick<LiveProps, "startUrl" | "stopUrl" | "openUrl"> {
  return {
    startUrl: `ballboi://live/${matchId}?action=start`,
    stopUrl: `ballboi://live/${matchId}?action=stop`,
    openUrl: `ballboi://live/${matchId}`,
  };
}

/** Checks what the mounted phone sent. Null when it isn't a Live Activity for this match. */
export function parseLiveProps(matchId: number, body: unknown): LiveProps | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const stage = STAGES.includes(b.stage as LiveStage) ? (b.stage as LiveStage) : null;
  const players = text(b.players);
  const status = text(b.status);
  const court = text(b.court);
  if (!stage || !players || !status || !court) return null;
  return {
    matchId,
    players,
    stage,
    status,
    court,
    battery: text(b.battery, 40),
    caption: text(b.caption, 300),
    countdownTo: time(b.countdownTo),
    recordingSince: time(b.recordingSince),
    canStart: b.canStart === true,
    canStop: b.canStop === true,
    ...liveLinks(matchId),
  };
}

/** Everyone on the match with an account, except the recorder, once each. */
export function liveViewers(recorderId: string, players: { clerkUserId: string | null }[]): string[] {
  const out: string[] = [];
  for (const p of players) {
    const id = p.clerkUserId;
    if (!id || id === recorderId || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/** Viewers who haven't had the Live Activity pushed to them yet. */
export function needsStart(viewers: string[], startedFor: string[]): string[] {
  return viewers.filter((v) => !startedFor.includes(v));
}

/** May this account see the session and send Start or Stop? The recorder and the other players. */
export function canControl(userId: string, recorderId: string, viewers: string[]): boolean {
  return userId === recorderId || viewers.includes(userId);
}

/** A Start or Stop the props say makes sense right now. */
export function commandAllowed(props: LiveProps, command: LiveCommand): boolean {
  return command === "start" ? props.canStart : props.canStop;
}

/** The content-state Apple hands the Live Activity: expo-widgets reads name and props (JSON). */
export function contentState(props: LiveProps): { name: string; props: string } {
  return { name: LIVE_ACTIVITY_NAME, props: JSON.stringify(props) };
}

/** Push-to-start: opens the Live Activity on a phone that isn't running it. */
export function startPayload(props: LiveProps, nowSeconds: number, alert: { title: string; body: string }) {
  return {
    aps: {
      timestamp: nowSeconds,
      event: "start",
      "attributes-type": "LiveActivityAttributes",
      attributes: { url: props.openUrl },
      "content-state": contentState(props),
      // iOS 18: ask for an update token straight away, so updates can follow.
      "input-push-token": 1,
      alert,
    },
  };
}

export function updatePayload(props: LiveProps, nowSeconds: number) {
  return { aps: { timestamp: nowSeconds, event: "update", "content-state": contentState(props) } };
}

/** Ends it, left on the Lock Screen for a few minutes with the final words. */
export function endPayload(props: LiveProps, nowSeconds: number, dismissAfterSeconds = 5 * 60) {
  return {
    aps: {
      timestamp: nowSeconds,
      event: "end",
      "content-state": contentState(props),
      "dismissal-date": nowSeconds + dismissAfterSeconds,
    },
  };
}

/** The alert that comes with push-to-start (iOS shows it as the Live Activity arrives). */
export function startAlert(recorderName: string): { title: string; body: string } {
  return { title: "Ball Boi", body: `${recorderName.trim() || "Your opponent"} is setting up Ball Boi for your match.` };
}

/** The stopped state, for the end push and a session that ends without one. */
export function stoppedProps(props: LiveProps): LiveProps {
  const off = { countdownTo: null, canStart: false, canStop: false };
  // The phone already said how it ended ("Recording stopped", or "Setup ended" with nothing recorded).
  if (props.stage === "stopped") return { ...props, ...off };
  return { ...props, ...off, stage: "stopped", status: "Recording stopped" };
}

/**
 * Only updates someone would notice go to Apple: a new stage, court, caption,
 * countdown, controls, or battery. Apple limits how often a Live Activity can
 * be updated, so the mounted phone's heartbeat sends nothing on its own.
 */
export function worthPushing(prev: LiveProps | null, next: LiveProps): boolean {
  if (!prev) return true;
  const keys: (keyof LiveProps)[] = ["stage", "status", "court", "battery", "caption", "countdownTo", "recordingSince", "canStart", "canStop", "players"];
  return keys.some((k) => prev[k] !== next[k]);
}
