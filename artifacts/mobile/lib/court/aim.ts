// What the mounted phone should do next, from one court find (spec: Ball Boi
// > Recording, "on-device court detection drives spoken guidance, one step at
// a time, in court terms"). The voice coach says the step out loud; the
// screen shows it as text.
//
// Corners are normalized in the upright still: (0, 0) top left, (1, 1)
// bottom right, the court seen from behind its near baseline. The near
// baseline is often below the frame, which is fine: only the far baseline
// and both sidelines have to be in view.
//
// Pure TypeScript, no React Native: tested in lib/__tests__/courtAim.test.ts.

import { CONFIDENT_FIT } from "@/lib/court/calibration";
import type { CourtFit } from "@/lib/court/detect";
import { isCourtShape } from "@/lib/court/geometry";

/**
 * One step, in the order the coach checks them. Each maps to one voice line
 * (lib/coachLines.ts). "ok" means nothing to fix: hold still and it locks.
 */
export type AimStep =
  | "none" // no court in view
  | "tiltUp" // aimed too low: the far baseline is at the top edge
  | "tiltDown" // aimed too high: too much above the far baseline
  | "turnLeft" // the court sits left of centre
  | "turnRight" // the court sits right of centre
  | "centre" // the phone is off to one side of the centre line
  | "raise" // mounted too low: the court is squashed flat
  | "lower" // mounted too high: the court looks steep
  | "ok";

// First settings, from a pinhole model of a phone 1 to 4 m up and 3 to 5 m
// behind the baseline. Tune them against the labeled test set.
/** The far baseline sits at least this far below the top of the frame. */
export const FAR_TOP_MIN = 0.12;
/** ...and no lower than this, so the far court isn't all sky. */
export const FAR_TOP_MAX = 0.45;
/** The far baseline's middle within this of the frame's centre, side to side. */
export const CENTRE_TOLERANCE = 0.1;
/** Near and far baseline middles line up within this: the phone is behind the centre mark. */
export const OFFSET_TOLERANCE = 0.15;
/** Court depth over far-baseline width, in pixels: below this the phone is too low. */
export const DEPTH_MIN = 0.6;
/** ...and above this it's too high. */
export const DEPTH_MAX = 2.6;
/** Video is 16:9: one unit across is 16/9 units down. */
const ASPECT = 16 / 9;

/** The next step for this find, one at a time. */
export function aimStep(fit: CourtFit | null): AimStep {
  if (!fit || !isCourtShape(fit.corners)) return "none";
  const [nl, nr, fr, fl] = fit.corners;
  const farY = (fl.y + fr.y) / 2;
  const farX = (fl.x + fr.x) / 2;
  const nearX = (nl.x + nr.x) / 2;
  const nearY = (nl.y + nr.y) / 2;
  if (farY < FAR_TOP_MIN) return "tiltUp";
  if (farY > FAR_TOP_MAX) return "tiltDown";
  if (farX < 0.5 - CENTRE_TOLERANCE) return "turnLeft";
  if (farX > 0.5 + CENTRE_TOLERANCE) return "turnRight";
  if (Math.abs(nearX - farX) > OFFSET_TOLERANCE) return "centre";
  const farWidth = (fr.x - fl.x) * ASPECT;
  if (farWidth > 0) {
    const depth = (nearY - farY) / farWidth;
    if (depth < DEPTH_MIN) return "raise";
    if (depth > DEPTH_MAX) return "lower";
  }
  return "ok";
}

/** True when this find is good enough to lock: nothing to fix and a confident fit. */
export function lockable(fit: CourtFit | null): boolean {
  return !!fit && fit.confidence >= CONFIDENT_FIT && aimStep(fit) === "ok";
}

/** The screen's court status, in words as well as color (G1). */
export type FrameStatus = "Court locked" | "Court in frame" | "Court not in frame" | "Finding the court";

/**
 * The setup chip, in step with the voice coach (John, Nov 8): "Court in
 * frame" only when the latest find shows a court and the coach isn't still
 * saying it can't see one. `coachCantSee` is true while the coach's last
 * guidance was "I can't see the court..." (11): a stray find (a tennis match
 * on a TV, say) then reads "Finding the court" until the coach agrees.
 */
export function frameStatus(stage: LockStage, step: AimStep | null, coachCantSee = false): FrameStatus {
  if (stage === "locked") return "Court locked";
  if (step === null) return "Finding the court";
  if (step === "none") return "Court not in frame";
  return coachCantSee ? "Finding the court" : "Court in frame";
}

// ---------------------------------------------------------------------------
// Locking. A court locks once two finds in a row are lockable while the phone
// is steady, so one lucky frame never locks. Once locked, it stays locked
// until the phone moves (lib/court/motion.ts).

/** Lockable finds in a row needed to lock. */
export const LOCK_STREAK = 2;
/** About 20 seconds without a lock, Record anyway turns on (spec: "Court won't lock"). */
export const RECORD_ANYWAY_MS = 20_000;

export type LockStage = "searching" | "holding" | "locked";

export interface LockState {
  stage: LockStage;
  /** Lockable finds in a row. */
  streak: number;
  /** When this search started (setup opened, or the phone moved after a lock). */
  searchStartedAt: number;
  /** The find that locked, kept as the match's court corners. */
  lockedFit: CourtFit | null;
}

export function startSearch(now: number): LockState {
  return { stage: "searching", streak: 0, searchStartedAt: now, lockedFit: null };
}

/** The next lock state after one find. `steady` is true when the phone isn't moving. */
export function nextLock(state: LockState, fit: CourtFit | null, steady: boolean): LockState {
  if (state.stage === "locked") return state;
  if (!steady || !lockable(fit)) return { ...state, stage: "searching", streak: 0 };
  const streak = state.streak + 1;
  if (streak >= LOCK_STREAK) return { ...state, stage: "locked", streak, lockedFit: fit };
  return { ...state, stage: "holding", streak };
}

/** The phone moved: a lock is lost and the search starts again from now. */
export function lostLock(state: LockState, now: number): LockState {
  return state.stage === "searching" && state.streak === 0 ? state : startSearch(now);
}

/** True once the search has run about 20 seconds without a lock. */
export function recordAnywayReady(state: LockState, now: number): boolean {
  return state.stage !== "locked" && now - state.searchStartedAt >= RECORD_ANYWAY_MS;
}
