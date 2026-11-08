// What the voice coach says next while setting up (spec: Ball Boi >
// Recording, voice positioning coach; claude/design-decisions/voice-coach.md).
//
// - One line at a time, never over another.
// - At least 10 seconds of quiet between any two pieces of setup guidance
//   (John, Nov 8): corrections (02 to 08) and their repeats, "Hold your phone
//   there" (09), "I can't see the court..." (11) and Record anyway (12).
//   The quiet counts from when the last of those lines finished playing.
// - The same correction stops after 3 times in a row while the phone hasn't
//   moved (G8). Once the phone moves the count starts over.
// - A correction, or "I can't see the court...", only once several frames in
//   a row agree on it (lib/court/aim.ts agreedStep). Until they do, quiet.
// - "Hold your phone there" (09) once the frame is nearly right and steady.
// - No court at all: "I can't see the court..." (11), under the same rules.
//   Armed and about 20 seconds without a lock: "You can record anyway..."
//   (12), once, as soon as the quiet allows, then the countdown starts on its
//   own (lib/recording/armedStart.ts).
// - Not held by the quiet, since they're events or timed: "Perfect. Court
//   locked." (10) and the chime, "Your phone just moved" (13), the countdown
//   (14 to 19) and the stop lines (20, 21). The screen plays those.
//
// Pure TypeScript, no React Native: tested in lib/__tests__/coach.test.ts.

import { COACH_LINES, type CueId } from "@/lib/coachLines";
import type { AimStep, LockStage } from "@/lib/court/aim";

/** Quiet between any two pieces of setup guidance, from the end of the last one (John, Nov 8). */
export const REPEAT_GAP_MS = 10_000;
/** G8: the same correction no more than this many times in a row while the phone hasn't moved. */
export const REPEAT_LIMIT = 3;

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
  /** No guidance before this: the last guidance line's end plus REPEAT_GAP_MS. */
  quietUntil: number;
}

export const COACH_START: CoachState = { last: null, lastAt: 0, times: 0, saidHold: false, quietUntil: 0 };

export interface CoachInput {
  now: number;
  /** The step the latest frames agree on (lib/court/aim.ts agreedStep), or null while they don't. */
  step: AimStep | null;
  stage: LockStage;
  /** A line is playing: nothing new starts. */
  busy: boolean;
  /** The phone has turned or tilted since `last` was said. */
  movedSinceLast: boolean;
  /** Armed and about 20 seconds without a lock: "You can record anyway..." (12) is waiting to be said. */
  recordAnywayDue?: boolean;
}

/** When the quiet after this line ends, if it starts playing now. */
function quietAfter(cue: CueId, now: number): number {
  return now + COACH_LINES[cue].ms + REPEAT_GAP_MS;
}

/**
 * The next piece of setup guidance for this frame (a correction, "Hold your
 * phone there" or Record anyway), or null to stay quiet. Locking, "Your phone
 * just moved" and the countdown lines are played by the screen, since they
 * come from events rather than frames.
 */
export function nextCoachCue(state: CoachState, input: CoachInput): { cue: CueId | null; state: CoachState } {
  const quiet = { cue: null, state };
  if (input.busy || input.stage === "locked") return quiet;
  if (input.now < state.quietUntil) return quiet;
  const { now } = input;

  if (input.recordAnywayDue) {
    return { cue: "recordAnyway", state: { ...state, quietUntil: quietAfter("recordAnyway", now) } };
  }

  // The frames don't agree yet: say nothing rather than guess.
  if (input.step === null) return quiet;

  if (input.step === "ok") {
    if (input.stage === "holding" && !state.saidHold) {
      return { cue: "hold", state: { ...state, saidHold: true, last: null, times: 0, quietUntil: quietAfter("hold", now) } };
    }
    return quiet;
  }

  const cue = correctionFor(input.step);
  if (!cue) return quiet;
  const said = (times: number) => ({
    cue,
    state: { last: cue, lastAt: now, times, saidHold: false, quietUntil: quietAfter(cue, now) },
  });
  if (cue !== state.last) return said(1);
  // The same correction again. They're trying: the count starts over.
  if (input.movedSinceLast) return said(1);
  if (state.times >= REPEAT_LIMIT) return quiet;
  return { cue, state: { ...said(state.times + 1).state, saidHold: state.saidHold } };
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
