// The second phone's clock for the live match: time left on the countdown, or
// time recorded so far. Pure: tested in lib/__tests__/liveActivity.test.ts.

import { formatElapsed, spokenDuration } from "@/lib/recording/format";
import type { LiveProps } from "@/lib/liveActivity/props";

function seconds(props: Pick<LiveProps, "stage" | "countdownTo" | "recordingSince">, now: number): number | null {
  if (props.stage === "counting" && props.countdownTo != null) return Math.max(0, Math.ceil((props.countdownTo - now) / 1000));
  if (props.stage === "recording" && props.recordingSince != null) return Math.max(0, Math.floor((now - props.recordingSince) / 1000));
  return null;
}

/** "4:59" or "1:02:05", or null when no clock runs. */
export function liveClock(props: Pick<LiveProps, "stage" | "countdownTo" | "recordingSince">, now: number): string | null {
  const s = seconds(props, now);
  return s === null ? null : formatElapsed(s);
}

/** For VoiceOver: "4 minutes 59 seconds". */
export function liveClockSpoken(props: Pick<LiveProps, "stage" | "countdownTo" | "recordingSince">, now: number): string | null {
  const s = seconds(props, now);
  return s === null ? null : spokenDuration(s);
}
