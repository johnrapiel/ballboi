// The voice coach's script: one manifest for every line it can say, its
// recorded clip and its caption. Captions are copied word for word from the
// table in claude/design-decisions/voice-coach.md (confirmed by John, Nov 7)
// and match the audio, so they are the coach's text alternative (WCAG 1.1.1).
//
// Never retype a caption anywhere else. The mounted screen, the partner
// phone, the Live Activity and Apple Watch all read this file.
//
// The clips are John's recorded voice, final as of Nov 7, in
// assets/audio/coach/ (masters in docs/voice-coach/masters/, outside the app).
// They play exactly as recorded: no pitch, speed or effects at runtime, and
// no text-to-speech anywhere. lib/recording/coachAudio.ts loads them.
//
// Pure TypeScript, no React Native: tested in lib/__tests__/coach.test.ts.

export type CueId =
  | "setup"
  | "tiltUp"
  | "tiltDown"
  | "raise"
  | "lower"
  | "left"
  | "right"
  | "centre"
  | "hold"
  | "locked"
  | "noLock"
  | "recordAnyway"
  | "moved"
  | "count5m"
  | "count10m"
  | "count15m"
  | "count1m"
  | "count10s"
  | "go"
  | "stopped"
  | "autoStopBattery"
  | "chime"
  // G10: low storage and the 4-hour cap have no recorded line: the chime, and a caption.
  | "autoStopStorage"
  | "autoStopTime";

export interface CoachLine {
  /** The clip in assets/audio/coach/, without .m4a. Silent lines play the chime. */
  file: string;
  /** What the line says, word for word. Null for the chime on its own. */
  caption: string | null;
  /** The clip's length, for timing (line 19 ends as capture starts). */
  ms: number;
}

export const COACH_LINES: Record<CueId, CoachLine> = {
  setup: { file: "01-setup", caption: "Mount your phone behind the baseline, camera facing the court.", ms: 4387 },
  tiltUp: { file: "02-tilt-up", caption: "Please tilt your phone up a little.", ms: 1632 },
  tiltDown: { file: "03-tilt-down", caption: "Please tilt your phone down a little.", ms: 1806 },
  raise: { file: "04-raise", caption: "Move your phone up a bit.", ms: 1728 },
  lower: { file: "05-lower", caption: "Please move your phone down a bit more.", ms: 2046 },
  left: { file: "06-left", caption: "Turn your phone slightly left.", ms: 2104 },
  right: { file: "07-right", caption: "Turn your phone slightly right.", ms: 2013 },
  centre: { file: "08-centre", caption: "Move your phone towards the centre of the court.", ms: 2359 },
  hold: { file: "09-hold", caption: "Hold your phone there.", ms: 1335 },
  locked: { file: "10-locked", caption: "Perfect. Court locked.", ms: 2234 },
  noLock: {
    file: "11-no-lock",
    caption: "I can't see the court. Make sure both sidelines and the far baseline are in view.",
    ms: 4942,
  },
  recordAnyway: { file: "12-record-anyway", caption: "You can record anyway. We'll fix the lines afterwards.", ms: 3467 },
  moved: { file: "13-moved", caption: "Your phone just moved. Let's line it up again.", ms: 3086 },
  count5m: { file: "14-count-5m", caption: "Recording starts in five minutes.", ms: 2366 },
  count10m: { file: "15-count-10m", caption: "Recording starts in ten minutes.", ms: 2456 },
  count15m: { file: "16-count-15m", caption: "Recording starts in fifteen minutes.", ms: 2707 },
  count1m: { file: "17-count-1m", caption: "One minute left.", ms: 1435 },
  count10s: { file: "18-count-10s", caption: "Ten seconds before recording.", ms: 2139 },
  go: { file: "19-go", caption: "Three. Two. One. Recording has started.", ms: 5047 },
  stopped: { file: "20-stopped", caption: "Recording stopped. Well played.", ms: 2601 },
  autoStopBattery: { file: "21-auto-stop", caption: "Your phone battery is low, so I've saved the match.", ms: 2924 },
  chime: { file: "22-chime", caption: null, ms: 900 },
  autoStopStorage: { file: "22-chime", caption: "Your phone is running out of space, so I've saved the match.", ms: 900 },
  autoStopTime: { file: "22-chime", caption: "We've hit four hours, so I've saved the match.", ms: 900 },
};

/** A line's caption, or null for the chime. The one place captions are read from. */
export function captionFor(id: CueId): string | null {
  return COACH_LINES[id].caption;
}
