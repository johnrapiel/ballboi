// Small helpers for Messages screens.

/** "5:02 PM" today, "Yesterday", "Mon" this week, then "Oct 12". */
export function shortTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (t >= startOfToday - 86_400_000) return "Yesterday";
  if (t >= startOfToday - 6 * 86_400_000) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Spoken time for VoiceOver: "5:02 PM", "yesterday at 5:02 PM", "October 12 at 5:02 PM". */
export function spokenTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const short = shortTime(iso, now);
  if (short === time) return time;
  if (short === "Yesterday") return `yesterday at ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} at ${time}`;
}

/** Up to two initials for the avatar circle. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** An id the server uses to make retried sends idempotent. */
export function newClientMessageId(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
