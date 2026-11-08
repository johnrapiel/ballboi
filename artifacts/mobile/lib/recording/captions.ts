// Captions for spoken cues (Wave 1 review D24). Every cue the recorder says
// out loud also shows as text, for at least 2 seconds, so a player who can't
// hear it (noise, sound off, hard of hearing) still sees it: on the Live
// Activity, Apple Watch or a partner phone, never the mounted phone (below).
// Pure helpers: no React Native.

/** Shortest time a caption stays up. */
export const CAPTION_MIN_MS = 2000;

/** How long a caption stays up: 2 seconds, longer for longer lines (about 3 words a second). */
export function captionDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(CAPTION_MIN_MS, Math.ceil(words / 3) * 1000);
}

/** Milliseconds still to wait before a caption shown at `shownAtMs` may go. 0 when it's had its time. */
export function captionWaitMs(text: string, shownAtMs: number, nowMs: number): number {
  return Math.max(0, shownAtMs + captionDurationMs(text) - nowMs);
}

/** How long a coach caption stays up: at least 2 seconds, and as long as its line plays. */
export function cueCaptionMs(text: string, clipMs: number): number {
  return Math.max(captionDurationMs(text), Math.ceil(clipMs));
}

// Where coach captions show (John, Nov 8): never on the mounted phone. Its
// screen faces the fence, so nobody can read it, during setup or recording.
// Captions go to the Live Activity, Apple Watch and a partner phone instead,
// all read from the manifest (lib/coachLines.ts).

export type CoachMoment = "setup" | "countdown" | "recording" | "after";

/** True when the mounted phone's screen shows the caption: never. */
export function captionOnMountedScreen(_moment: CoachMoment): boolean {
  return false;
}

/**
 * True when the caption goes to the Live Activity, Apple Watch and a partner
 * phone at this moment: always, during setup as well as the match
 * (acceptance 34), so a player away from the mounted phone can read every line.
 */
export function captionOnLiveActivity(_moment: CoachMoment): boolean {
  return true;
}

/**
 * True when VoiceOver should read a coach line on the mounted phone: never.
 * The line already plays out loud from that phone, so reading it would double
 * the audio, and its caption lives on the Live Activity, Watch and partner phone.
 */
export function announceCaption(_played: boolean): boolean {
  return false;
}
