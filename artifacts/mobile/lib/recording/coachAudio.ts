// The voice coach's recorded clips, for the bundler. The script itself (which
// line, which caption) is lib/coachLines.ts; this only maps each clip's file
// name to its bundled asset. The clips are final and play as recorded.

/* eslint-disable @typescript-eslint/no-require-imports */
export const COACH_CLIPS: Record<string, number> = {
  "01-setup": require("@/assets/audio/coach/01-setup.m4a"),
  "02-tilt-up": require("@/assets/audio/coach/02-tilt-up.m4a"),
  "03-tilt-down": require("@/assets/audio/coach/03-tilt-down.m4a"),
  "04-raise": require("@/assets/audio/coach/04-raise.m4a"),
  "05-lower": require("@/assets/audio/coach/05-lower.m4a"),
  "06-left": require("@/assets/audio/coach/06-left.m4a"),
  "07-right": require("@/assets/audio/coach/07-right.m4a"),
  "08-centre": require("@/assets/audio/coach/08-centre.m4a"),
  "09-hold": require("@/assets/audio/coach/09-hold.m4a"),
  "10-locked": require("@/assets/audio/coach/10-locked.m4a"),
  "11-no-lock": require("@/assets/audio/coach/11-no-lock.m4a"),
  "12-record-anyway": require("@/assets/audio/coach/12-record-anyway.m4a"),
  "13-moved": require("@/assets/audio/coach/13-moved.m4a"),
  "14-count-5m": require("@/assets/audio/coach/14-count-5m.m4a"),
  "15-count-10m": require("@/assets/audio/coach/15-count-10m.m4a"),
  "16-count-15m": require("@/assets/audio/coach/16-count-15m.m4a"),
  "17-count-1m": require("@/assets/audio/coach/17-count-1m.m4a"),
  "18-count-10s": require("@/assets/audio/coach/18-count-10s.m4a"),
  "19-go": require("@/assets/audio/coach/19-go.m4a"),
  "20-stopped": require("@/assets/audio/coach/20-stopped.m4a"),
  "21-auto-stop": require("@/assets/audio/coach/21-auto-stop.m4a"),
  "22-chime": require("@/assets/audio/coach/22-chime.m4a"),
};
