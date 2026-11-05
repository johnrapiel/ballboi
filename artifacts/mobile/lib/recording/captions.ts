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
