// What the phone sends the server about the court, and when the player is
// asked to fix the lines (spec: Ball Boi > After the match, "Court-line fix
// appears only when detection confidence is low").
//
// Pure TypeScript, no React Native: tested in lib/__tests__/court.test.ts.

import type { CourtFit } from "@/lib/court/detect";
import { CALIBRATION_POINT_ORDER, isCourtShape, type Corners, type Point } from "@/lib/court/geometry";

/**
 * At or above this, the phone trusts its own find and sends it. Below it, the
 * player sees the court-line fix. A first setting, to tune against the
 * labeled test set; the server accepts its own finds from 0.35.
 */
export const CONFIDENT_FIT = 0.55;

/** Where the corners came from: detected on the phone, or placed by the player. */
export type CalibrationSource = "phone-detected" | "phone-fixed";

/** The shape the API stores in session metadata as `courtCalibration`. */
export interface CourtCalibration {
  version: 1;
  pointOrder: typeof CALIBRATION_POINT_ORDER;
  points: Point[];
  source: CalibrationSource;
  /** The detection's confidence, when it was detected. */
  confidence?: number;
}

/** True when the player should check the lines: nothing found, or a weak find. */
export function needsCourtFix(fit: CourtFit | null): boolean {
  return !fit || fit.confidence < CONFIDENT_FIT || !isCourtShape(fit.corners);
}

const round = (v: number) => Math.round(v * 10000) / 10000;

/** The calibration to send, or null when the corners can't be a court. */
export function toCalibration(corners: readonly Point[], source: CalibrationSource, confidence?: number): CourtCalibration | null {
  if (!isCourtShape(corners)) return null;
  return {
    version: 1,
    pointOrder: CALIBRATION_POINT_ORDER,
    points: corners.map((p) => ({ x: round(p.x), y: round(p.y) })),
    source,
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

/** A confident find becomes the calibration; anything else waits for the fix. */
export function calibrationFromFit(fit: CourtFit | null): CourtCalibration | null {
  if (!fit || needsCourtFix(fit)) return null;
  return toCalibration(fit.corners, "phone-detected", fit.confidence);
}

/** What a recording's server session starts with: plain facts from the phone, and the corners if there are any. */
export function sessionMetadata(calibration: CourtCalibration | null | undefined): Record<string, unknown> {
  return calibration ? { source: "ios", courtCalibration: calibration } : { source: "ios" };
}

/** How far one press of a move button shifts a corner, as a share of the frame. */
export const NUDGE = 0.01;
/** Corners may sit a little off the frame: the near baseline is often cut off. */
export const CORNER_RANGE = { min: -0.15, max: 1.15 } as const;

export function clampCorner(p: Point): Point {
  const c = (v: number) => Math.min(CORNER_RANGE.max, Math.max(CORNER_RANGE.min, v));
  return { x: c(p.x), y: c(p.y) };
}

export type Nudge = "up" | "down" | "left" | "right";

/** Moves one corner a step, for the buttons and VoiceOver actions that stand in for dragging. */
export function nudgeCorner(corners: Corners, index: number, dir: Nudge, step = NUDGE): Corners {
  const next = [...corners] as Corners;
  const p = corners[index];
  const d = { up: { x: 0, y: -step }, down: { x: 0, y: step }, left: { x: -step, y: 0 }, right: { x: step, y: 0 } }[dir];
  next[index] = clampCorner({ x: p.x + d.x, y: p.y + d.y });
  return next;
}
