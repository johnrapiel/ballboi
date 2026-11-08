// What the voice coach says next while setting up (spec: Ball Boi >
// Recording, voice positioning coach; claude/design-decisions/voice-coach.md).
//
// - One line at a time, never over another.
// - A correction (02 to 08) from court detection. The same correction
//   repeats no sooner than every 7 seconds while the phone hasn't moved, and
//   stops after 3 times in a row (G8). Its caption stays up.
// - "Hold your phone there" (09) once the frame is nearly right and steady,
//   then "Perfect. Court locked." (10) and the chime when it locks.
// - No court at all: "I can't see the court..." (11), under the same repeat
//   rule. After about 20 seconds: "You can record anyway..." (12), once.
//
// Pure TypeScript, no React Native: tested in lib/__tests__/coach.test.ts.

import type { CueId } from "@/lib/coachLines";
import type { AimStep, LockStage } from "@/lib/court/aim";

/** G8: the same correction no sooner than this while the phone hasn't moved. */
export const REPEAT_GAP_MS = 7000;
/** G8: and no more than this many times in a row. */
export const REPEAT_LIMIT = 3;
/** After the phone moves, the same correction may come back this soon. */
export const MOVED_GAP_MS = 3000;

const STEP_CUE: Partial<Record<AimStep, CueId>> = {
  none: "noLock",
  tiltUp: "tiltUp",
  tiltDown: "tiltDown",
  raise: "raise",
  lower: "lower",
  turnLeft: "left",
  turnRight: "right",
  centre: "centre",
};

/** The correction for a step, or null for "ok". */
export function correctionFor(step: AimStep): CueId | null {
  return STEP_CUE[step] ?? null;
}

export interface CoachState {
  /** The last correction said, and when. */
  last: CueId | null;
  lastAt: number;
  /** How many times in a row `last` has been said without the phone moving. */
  times: number;
  /** "Hold your phone there" said since the last correction. */
  saidHold: boolean;
}

export const COACH_START: CoachState = { last: null, lastAt: 0, times: 0, saidHold: false };

export interface CoachInput {
  now: number;
  /** The latest step from court detection. */
  step: AimStep;
  stage: LockStage;
  /** A line is playing: nothing new starts. */
  busy: boolean;
  /** The phone has turned or tilted since `last` was said. */
  movedSinceLast: boolean;
}

/**
 * The next correction or hold line for this frame, or null to stay quiet.
 * Locking, Record anyway and the countdown lines are played by the screen,
 * since they come from events rather than frames.
 */
export function nextCoachCue(state: CoachState, input: CoachInput): { cue: CueId | null; state: CoachState } {
  const quiet = { cue: null, state };
  if (input.busy || input.stage === "locked") return quiet;

  if (input.step === "ok") {
    if (input.stage === "holding" && !state.saidHold) {
      return { cue: "hold", state: { ...state, saidHold: true, last: null, times: 0 } };
    }
    return quiet;
  }

  const cue = correctionFor(input.step);
  if (!cue) return quiet;
  if (cue !== state.last) {
    return { cue, state: { last: cue, lastAt: input.now, times: 1, saidHold: false } };
  }
  // The same correction again.
  if (input.movedSinceLast) {
    // They're trying: the count starts over, after a short pause.
    if (input.now - state.lastAt < MOVED_GAP_MS) return quiet;
    return { cue, state: { ...state, lastAt: input.now, times: 1, saidHold: false } };
  }
  if (state.times >= REPEAT_LIMIT) return quiet;
  if (input.now - state.lastAt < REPEAT_GAP_MS) return quiet;
  return { cue, state: { ...state, lastAt: input.now, times: state.times + 1 } };
}

// ---------------------------------------------------------------------------
// Countdown lines: 14, 15 or 16 at the start, 17 at one minute left, 18 at
// ten seconds, and 19 timed so capture starts as it ends. Start Now plays 19
// only.

/** The opening line for a countdown of this many minutes, or null for Start Now. */
export function countdownOpening(minutes: number): CueId | null {
  if (minutes === 5) return "count5m";
  if (minutes === 10) return "count10m";
  if (minutes === 15) return "count15m";
  return null;
}

/**
 * The line due at this many milliseconds before capture, given what's been
 * played already. `goMs` is how long line 19 runs.
 */
export function countdownCueDue(msLeft: number, totalMs: number, played: ReadonlySet<CueId>, goMs: number): CueId | null {
  if (msLeft <= goMs) return played.has("go") ? null : "go";
  if (totalMs > 60_000 && msLeft <= 60_000 && msLeft > 10_000 && !played.has("count1m")) return "count1m";
  if (totalMs > 10_000 && msLeft <= 10_000 && !played.has("count10s")) return "count10s";
  return null;
}

/** No corrections this close to capture, so 18 and 19 are never held up. */
export const COUNTDOWN_QUIET_MS = 15_000;
