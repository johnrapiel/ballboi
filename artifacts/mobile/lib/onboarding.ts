// Onboarding steps 3 to 6 (spec: Roles and onboarding) and Ball Boi Rating
// helpers. Step 1 is sign-in and step 2 is the age check (app/age-check.tsx).

import { apiErrorMessage, apiFetch, type TokenGetter } from "@/lib/api";

// ─── Progress ────────────────────────────────────────────────────────────────

export const ONBOARDED = "done";

/** Set on the Clerk user after the last step, like the age check flag. */
export function isOnboarded(metadata: unknown): boolean {
  return (metadata as { onboarding?: unknown } | null | undefined)?.onboarding === ONBOARDED;
}

/** The four steps after the age check, in order. */
export const STEPS = ["name", "home", "rating", "intent"] as const;
export type Step = (typeof STEPS)[number];

export function stepLabel(step: Step): string {
  return `Step ${STEPS.indexOf(step) + 1} of ${STEPS.length}`;
}

// ─── Name and photo ──────────────────────────────────────────────────────────

/** "Alex Kim" → "AK", "alex" → "A". For the avatar when there's no photo. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export const NAME_MAX = 60;

// ─── Home area ───────────────────────────────────────────────────────────────

export function isZip(v: string): boolean {
  return /^\d{5}$/.test(v.trim());
}

// ─── Rating quiz ─────────────────────────────────────────────────────────────

/**
 * Plain-language descriptions that set a Ball Boi Rating (NTRP scale), the
 * player's level for matching. The API only accepts these ratings.
 */
export const QUIZ_LEVELS: { rating: number; title: string; description: string }[] = [
  {
    rating: 2.5,
    title: "Getting started",
    description: "I'm new or coming back. I can keep a short rally going at an easy pace.",
  },
  {
    rating: 3.0,
    title: "Steady rallies",
    description: "I rally at a medium pace and I'm working on consistency and my serve.",
  },
  {
    rating: 3.5,
    title: "League regular",
    description: "I place the ball with some control, play doubles at the net, and play league matches.",
  },
  {
    rating: 4.0,
    title: "Reliable all-court",
    description: "I hit with pace and spin, my serve sets up points, and I win matches with a plan.",
  },
  {
    rating: 4.5,
    title: "Advanced",
    description: "I play tournaments, vary pace and spin on purpose, and my serve wins points outright.",
  },
];

/** "3.5". Ratings are levels in half steps. */
export function formatRating(n: number): string {
  return n.toFixed(1);
}

export type RatingSource = "self" | "verified";

// ─── Intent ──────────────────────────────────────────────────────────────────

export type Intent = "run_league" | "join_league" | "find_matches" | "record";

export const INTENTS: { value: Intent; title: string; description: string }[] = [
  { value: "run_league", title: "Run a league", description: "Set up a season and invite players." },
  { value: "join_league", title: "Join a league", description: "Use an invite code from your league." },
  { value: "find_matches", title: "Find matches near me", description: "Meet players at your level nearby." },
  { value: "record", title: "Record my play", description: "Film a match and see your stats." },
];

// ─── API ─────────────────────────────────────────────────────────────────────

export interface Profile {
  displayName: string;
  avatarUrl: string | null;
  homeZip: string | null;
  rating: number | null;
  ratingSource: RatingSource | null;
  intent: Intent | null;
}

/** The signed-in player's profile, or null before step 3 creates it. */
export async function fetchProfile(getToken: TokenGetter): Promise<Profile | null> {
  const res = await apiFetch("/api/users/me", getToken);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await apiErrorMessage(res, "We couldn't load your profile."));
  const body = (await res.json()) as Record<string, unknown>;
  return {
    displayName: String(body.displayName ?? ""),
    avatarUrl: (body.avatarUrl as string | null) ?? null,
    homeZip: (body.homeZip as string | null) ?? null,
    rating: body.rating == null ? null : Number(body.rating),
    ratingSource: (body.ratingSource as RatingSource | null) ?? null,
    intent: (body.intent as Intent | null) ?? null,
  };
}

async function send(path: string, getToken: TokenGetter, method: string, body: unknown, fallback: string) {
  const res = await apiFetch(path, getToken, { method, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await apiErrorMessage(res, fallback));
  return res;
}

/** Step 3: create the profile, or update it when coming back to this step. */
export async function saveNameAndPhoto(
  getToken: TokenGetter,
  input: { displayName: string; avatarUrl: string | null; email?: string | null },
  exists: boolean,
) {
  const fallback = "We couldn't save your name. Try again.";
  if (exists) {
    await send("/api/users/me", getToken, "PUT", { displayName: input.displayName, avatarUrl: input.avatarUrl }, fallback);
  } else {
    await send("/api/users/me", getToken, "POST", input, fallback);
  }
}

/** Uploads a picked photo and returns its storage path for `avatarUrl`. */
export async function uploadPhoto(
  getToken: TokenGetter,
  photo: { uri: string; mimeType?: string | null; fileSize?: number | null },
): Promise<string> {
  const file = await fetch(photo.uri);
  const blob = await file.blob();
  const contentType = photo.mimeType ?? blob.type ?? "image/jpeg";
  const res = await send(
    "/api/storage/uploads/request-url",
    getToken,
    "POST",
    { name: "profile-photo", size: photo.fileSize ?? blob.size, contentType },
    "We couldn't upload your photo.",
  );
  const { uploadURL, objectPath } = (await res.json()) as { uploadURL: string; objectPath: string };
  const put = await fetch(uploadURL, { method: "PUT", body: blob, headers: { "Content-Type": contentType } });
  if (!put.ok) throw new Error("We couldn't upload your photo.");
  return objectPath;
}

/** Step 4. Coordinates only when the player used "Use my location". */
export async function saveHomeArea(
  getToken: TokenGetter,
  area: { zip: string; latitude?: number; longitude?: number },
) {
  await send("/api/users/me/home-area", getToken, "PUT", area, "We couldn't save your home area. Try again.");
}

/** Step 5. Returns the saved rating, labeled Self-rated. */
export async function saveSelfRating(getToken: TokenGetter, rating: number) {
  const res = await send("/api/users/me/rating/self", getToken, "POST", { rating }, "We couldn't save your rating. Try again.");
  return (await res.json()) as { rating: number; source: RatingSource };
}

/** Step 6. Also marks onboarding complete on the server. */
export async function saveIntent(getToken: TokenGetter, intent: Intent) {
  await send("/api/users/me/intent", getToken, "PUT", { intent }, "We couldn't save that. Try again.");
}
