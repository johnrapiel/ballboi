// The armed start (spec: Ball Boi > Recording, Start; John, Nov 8).
//
// A phone mounted on a fence can't be reached, so the start is picked while
// the phone is still in your hand:
//
// 1. Ready: pick "Start in Now / 5 / 10 / 15 min" and tap Record. It works as
//    soon as the camera is ready, with or without a court lock.
// 2. Waiting: the phone is armed. The voice coach guides aiming as usual and
//    the screen says it's waiting for the court, with Cancel.
// 3. Counting: once the court locks ("Perfect. Court locked." and the chime),
//    the chosen countdown runs by itself. Already locked when you tap Record?
//    It starts straight away.
// 4. Paused: the phone moved during the countdown. Line 13 plays, the coach
//    re-aims, and the countdown carries on from where it stopped once the
//    court locks again.
// 5. Fallback: about 20 seconds waiting without a lock, after the coach's
//    quiet, line 12 plays and the countdown starts anyway. The court lines are
//    fixed after the match. The 20 seconds count from arming (or from the
//    bump), not from opening the camera, so there's time to mount the phone.
//
// Pure TypeScript, no React Native: tested in lib/__tests__/armedStart.test.ts.

import { RECORD_ANYWAY_MS } from "@/lib/court/aim";

export type ArmedStage = "waiting" | "counting" | "paused";

export interface ArmedStart {
  stage: ArmedStage;
  /** The whole countdown, as chosen. Line 17 only plays when it's over a minute. */
  totalMs: number;
  /** Time left on the countdown while waiting or paused (it doesn't run then). */
  msLeft: number;
  /** When capture starts, while counting. 0 otherwise. */
  startAt: number;
  /** When this wait for the court began: arming, or the bump that paused it. */
  waitingSince: number;
  /** Counting without a lock, after line 12 (Record anyway). */
  anyway: boolean;
}

/** How long the countdown runs. Start Now is as long as line 19, so capture starts as it ends. */
export function countdownMs(delayMinutes: number, goMs: number): number {
  return delayMinutes === 0 ? goMs : delayMinutes * 60_000;
}

function counting(s: ArmedStart, now: number, anyway: boolean): ArmedStart {
  return { ...s, stage: "counting", startAt: now + s.msLeft, anyway };
}

/** Record tapped: armed, or counting straight away when the court is already locked. */
export function arm(delayMinutes: number, now: number, goMs: number, locked: boolean): ArmedStart {
  const total = countdownMs(delayMinutes, goMs);
  const waiting: ArmedStart = { stage: "waiting", totalMs: total, msLeft: total, startAt: 0, waitingSince: now, anyway: false };
  return locked ? counting(waiting, now, false) : waiting;
}

/** The court locked. Waiting or paused: the countdown runs from what's left. */
export function onCourtLocked(s: ArmedStart, now: number): ArmedStart {
  if (s.stage === "counting") return s.anyway ? { ...s, anyway: false } : s;
  return counting(s, now, false);
}

/**
 * The phone moved away from where the court locked. Counting: the countdown
 * pauses with its time left, unless line 19 has started (capture is moments
 * away, so it carries on).
 */
export function onCourtLost(s: ArmedStart, now: number, goMs: number, goStarted: boolean): ArmedStart {
  if (s.stage !== "counting" || goStarted) return s;
  const left = s.startAt - now;
  if (left <= goMs) return s;
  return { ...s, stage: "paused", msLeft: left, startAt: 0, waitingSince: now, anyway: false };
}

/** About 20 seconds waiting for the court: line 12 is due, once the coach's quiet allows. */
export function fallbackDue(s: ArmedStart | null, now: number): boolean {
  return !!s && s.stage !== "counting" && now - s.waitingSince >= RECORD_ANYWAY_MS;
}

/** Line 12 has played: the countdown runs anyway, from what's left. */
export function startAnyway(s: ArmedStart, now: number): ArmedStart {
  if (s.stage === "counting") return s;
  return counting(s, now, true);
}

/** Time left on the countdown right now. */
export function timeLeft(s: ArmedStart, now: number): number {
  return s.stage === "counting" ? Math.max(0, s.startAt - now) : s.msLeft;
}

/**
 * Can "Perfect. Court locked." and the chime play now? Only while setting up,
 * and not once line 19 has started: capture follows it straight away, and no
 * voice may land in the recording (John, Nov 9: he heard the lock line after
 * capture had begun, when the court locked during line 19 of a Record anyway
 * start).
 */
export function lockLineAllowed(settingUp: boolean, goStarted: boolean): boolean {
  return settingUp && !goStarted;
}

/** Not recording yet: armed, paused or counting down. The words both phones show until capture really starts. */
export const NOT_RECORDING_YET = "Not recording yet";
