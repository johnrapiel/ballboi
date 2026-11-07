// Delayed start (spec: Ball Boi > Recording, Start): "Start in Now / 5 / 10 /
// 15 min with spoken countdown cues". The cues are the voice coach's recorded
// lines 14 to 19 (lib/court/coach.ts picks them, lib/coachLines.ts has their
// words), each shown as a caption on the mounted screen.

export const START_DELAYS = [
  { minutes: 0, label: "Now" },
  { minutes: 5, label: "5 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 15, label: "15 min" },
] as const;

export type StartDelayMinutes = (typeof START_DELAYS)[number]["minutes"];

/** "4:59" style for the countdown clock. */
export function countdownClock(secondsLeft: number): string {
  const s = Math.max(0, secondsLeft);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
