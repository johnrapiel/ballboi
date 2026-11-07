// On-screen captions for spoken cues (Wave 1 review D24). Every cue the
// recorder says out loud also shows as text, for at least 2 seconds, so a
// player who can't hear it (noise, sound off, hard of hearing) still sees it.
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

// G9: captions show only where someone can see them. On the mounted phone
// during setup and the countdown (the player is at the phone, moving it);
// once recording starts, on the Live Activity and Apple Watch instead, never
// the mounted screen.

export type CoachMoment = "setup" | "countdown" | "recording" | "after";

/** True when the mounted phone's screen shows the caption at this moment. */
export function captionOnMountedScreen(moment: CoachMoment): boolean {
  return moment === "setup" || moment === "countdown";
}

/**
 * True when the caption goes to the Live Activity and Watch at this moment:
 * always, during setup as well as the match (acceptance 34), so a player
 * away from the mounted phone can read every line.
 */
export function captionOnLiveActivity(_moment: CoachMoment): boolean {
  return true;
}

/**
 * True when VoiceOver should read a caption on the mounted phone. When the
 * line played out loud from the same phone, it's already heard: reading it
 * too would double it. Muted, or a clip that couldn't play, it's read once.
 */
export function announceCaption(played: boolean): boolean {
  return !played;
}
