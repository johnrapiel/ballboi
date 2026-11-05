// Battery rule for recording (Wave 1 review D14), kept free of React Native
// so lib/__tests__ can run it in Node. safety.ts reads the phone's battery
// and calls this.

/** Lowest charge, in whole percent, to start or keep recording unplugged. */
export const MIN_BATTERY_PERCENT = 10;

export const LOW_BATTERY_START_MESSAGE = "Charge your phone to at least 10% (or plug it in) to record a match.";

/**
 * True when the battery is too low to record: under 10% and not plugged in.
 * `level` is 0 to 1; -1 or anything else unknown (a simulator) never blocks.
 * 9.6% reads as 10% on the phone, so it's rounded the way iOS shows it.
 */
export function batteryTooLow(level: number, pluggedIn: boolean): boolean {
  if (pluggedIn) return false;
  if (!Number.isFinite(level) || level < 0 || level > 1) return false;
  return Math.round(level * 100) < MIN_BATTERY_PERCENT;
}
