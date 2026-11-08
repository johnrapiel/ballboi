// Has the mounted phone moved? From the phone's motion sensor (expo-sensors
// DeviceMotion), so the court check never needs a photo while the camera is
// recording. Used for: "Hold your phone there" only when it's steady, losing
// the lock when it's bumped (line 13 during the countdown), the G8 repeat
// rule ("while the phone hasn't moved"), and "Court in frame" while
// recording.
//
// Pure TypeScript, no React Native: tested in lib/__tests__/courtAim.test.ts.

export interface Attitude {
  /** Radians, as DeviceMotion reports them. */
  alpha: number;
  beta: number;
  gamma: number;
}

/** Turning or tilting more than this from where it locked counts as moved. */
export const MOVED_DEGREES = 4;
/** Slower than this, in degrees a second, counts as steady. */
export const STEADY_DEG_PER_S = 6;

const DEG = 180 / Math.PI;

/** Smallest difference between two angles, in degrees. */
function angleDelta(a: number, b: number): number {
  let d = (a - b) * DEG;
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  return Math.abs(d);
}

/** The largest change on any axis between two attitudes, in degrees. */
export function attitudeChange(a: Attitude, b: Attitude): number {
  return Math.max(angleDelta(a.alpha, b.alpha), angleDelta(a.beta, b.beta), angleDelta(a.gamma, b.gamma));
}

/** True when the phone has turned or tilted away from `ref`. */
export function hasMoved(ref: Attitude | null, now: Attitude | null): boolean {
  if (!ref || !now) return false;
  return attitudeChange(ref, now) > MOVED_DEGREES;
}

/** True when the rotation rate (degrees a second on each axis) is low. Unknown counts as steady. */
export function isSteady(rate: { alpha: number; beta: number; gamma: number } | null | undefined): boolean {
  if (!rate) return true;
  const m = Math.max(Math.abs(rate.alpha), Math.abs(rate.beta), Math.abs(rate.gamma));
  return !Number.isFinite(m) || m < STEADY_DEG_PER_S;
}
