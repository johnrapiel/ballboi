// Onboarding input checks. Spec: Roles and onboarding, steps 4 and 6.

/** "What brings you here?" answers. Stored in `users.intent`. */
export const USER_INTENTS = ["run_league", "join_league", "find_matches", "record"] as const;
export type UserIntent = (typeof USER_INTENTS)[number];

/** Two decimals is about a kilometer: close enough for "~4 mi away", never an exact spot. */
export function approximateCoordinate(n: number): number {
  return Math.round(n * 100) / 100;
}

export type HomeArea = { zip: string; latitude: number | null; longitude: number | null };

/**
 * `{ zip, latitude?, longitude? }`. The zip is required (entering it must work
 * without granting location). Coordinates come only from "Use my location",
 * both or neither, and are rounded before they're stored.
 */
export function parseHomeArea(body: unknown): HomeArea | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const zip = typeof b.zip === "string" ? b.zip.trim() : "";
  if (!/^\d{5}$/.test(zip)) return { error: "Enter a 5-digit zip code." };

  const hasLat = b.latitude != null;
  const hasLng = b.longitude != null;
  if (hasLat !== hasLng) return { error: "Send both latitude and longitude, or neither." };
  if (!hasLat) return { zip, latitude: null, longitude: null };

  const lat = b.latitude;
  const lng = b.longitude;
  if (typeof lat !== "number" || typeof lng !== "number" || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { error: "That location doesn't look right." };
  }
  return { zip, latitude: approximateCoordinate(lat), longitude: approximateCoordinate(lng) };
}

export function isUserIntent(v: unknown): v is UserIntent {
  return typeof v === "string" && (USER_INTENTS as readonly string[]).includes(v);
}
