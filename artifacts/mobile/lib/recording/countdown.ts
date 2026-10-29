// Delayed start (spec: Ball Boi > Recording, Start): "Start in Now / 5 / 10 /
// 15 min with spoken countdown cues". Every spoken cue is also shown as a
// caption, since voice cues always need a text alternative.

export const START_DELAYS = [
  { minutes: 0, label: "Now" },
  { minutes: 5, label: "5 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 15, label: "15 min" },
] as const;

export type StartDelayMinutes = (typeof START_DELAYS)[number]["minutes"];

/**
 * The cue to speak when this many seconds are left, or null for silence.
 * Every whole minute, then 30 and 10 seconds, then 5 down to 1.
 */
export function cueAt(secondsLeft: number, totalSeconds: number): string | null {
  if (secondsLeft <= 0) return "Recording";
  if (secondsLeft === totalSeconds || secondsLeft % 60 === 0) {
    const m = secondsLeft / 60;
    if (Number.isInteger(m)) return `Recording starts in ${m} ${m === 1 ? "minute" : "minutes"}`;
  }
  if (secondsLeft === 30) return "Recording starts in 30 seconds";
  if (secondsLeft === 10) return "Recording starts in 10 seconds";
  if (secondsLeft <= 5) return String(secondsLeft);
  return null;
}

/** "4:59" style for the countdown clock. */
export function countdownClock(secondsLeft: number): string {
  const s = Math.max(0, secondsLeft);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
