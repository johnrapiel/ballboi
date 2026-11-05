// The court directory (spec: Discover > Court directory). Pure rules; the
// routes in routes/courts.ts fetch and save.

import { COURT_ACCESS, COURT_SURFACES, type CourtAccess, type CourtSurface } from "@workspace/db";

import { distanceLabel, milesBetween, zipCenter, type Point } from "./discoverArea.js";

export interface CourtRow {
  id: number;
  name: string;
  place: string | null;
  zip: string;
  latitude: number;
  longitude: number;
  access: string;
  surface: string | null;
  lights: boolean | null;
  courtCount: number | null;
}

export interface CourtCard {
  courtId: number;
  name: string;
  place: string | null;
  access: CourtAccess;
  surface: CourtSurface | null;
  lights: boolean | null;
  courtCount: number | null;
  distanceLabel: string;
}

export interface NewCourt {
  name: string;
  place: string | null;
  zip: string;
  point: Point;
  access: CourtAccess;
  surface: CourtSurface | null;
  lights: boolean | null;
  courtCount: number | null;
}

/** How many courts one account can add in a day, so the list stays real. */
export const DAILY_COURT_LIMIT = 10;
/** How far "I'm at the court" can be from the zip it names. */
const MAX_FROM_ZIP_MILES = 25;
/** Two courts this close with the same name are the same court. */
const SAME_COURT_MILES = 0.25;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

/** Text checks for names and places, like the first-message filter: no links, phone numbers or slurs. */
export type TextCheck = (text: string) => boolean;

/** Checks a new court. Returns the clean court, or the problem in the player's words. */
export function parseNewCourt(body: unknown, textOk: TextCheck): NewCourt | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2) return { error: "Give the court a name." };
  if (name.length > 60) return { error: "Keep the name to 60 characters." };
  const place = typeof b.place === "string" && b.place.trim() ? b.place.trim().replace(/\s+/g, " ") : null;
  if (place && place.length > 80) return { error: "Keep where it is to 80 characters." };
  if (!textOk(name) || (place && !textOk(place))) return { error: "Court names and places can't include links, phone numbers or slurs." };
  const zip = typeof b.zip === "string" ? b.zip.trim() : "";
  if (!/^\d{5}$/.test(zip)) return { error: "Enter the court's 5-digit zip code." };
  const center = zipCenter(zip);
  if (!center) return { error: `We couldn't place zip code ${zip}. Check it and try again.` };
  // "I'm at the court": the phone's location, if it's near the zip; otherwise the zip's center.
  let point: Point = center;
  if (typeof b.latitude === "number" && typeof b.longitude === "number") {
    const here = { latitude: b.latitude, longitude: b.longitude };
    if (Math.abs(here.latitude) <= 90 && Math.abs(here.longitude) <= 180 && milesBetween(here, center) <= MAX_FROM_ZIP_MILES) point = here;
  }
  const access = b.access === undefined ? "public" : b.access;
  if (!isOneOf(COURT_ACCESS, access)) return { error: "Pick public or club." };
  const surface = b.surface ?? null;
  if (surface !== null && !isOneOf(COURT_SURFACES, surface)) return { error: "Pick hard, clay, grass or other." };
  const lights = b.lights ?? null;
  if (lights !== null && typeof lights !== "boolean") return { error: "Choose lights or no lights." };
  const courtCount = b.courtCount ?? null;
  if (courtCount !== null && (!Number.isInteger(courtCount) || (courtCount as number) < 1 || (courtCount as number) > 60)) {
    return { error: "Courts must be a number from 1 to 60." };
  }
  return { name, place, zip, point, access, surface, lights, courtCount: courtCount as number | null };
}

const normalized = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(tennis|courts?|the|park)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

/** An existing court that's the one being added: the same name, a few hundred yards away. */
export function findSameCourt(existing: CourtRow[], add: Pick<NewCourt, "name" | "point">): CourtRow | null {
  const key = normalized(add.name);
  return (
    existing.find(
      (c) => normalized(c.name) === key && milesBetween({ latitude: c.latitude, longitude: c.longitude }, add.point) <= SAME_COURT_MILES,
    ) ?? null
  );
}

export function courtCard(viewer: Point | null, c: CourtRow): CourtCard & { miles: number | null } {
  const miles = viewer ? milesBetween(viewer, { latitude: c.latitude, longitude: c.longitude }) : null;
  return {
    courtId: c.id,
    name: c.name,
    place: c.place,
    access: isOneOf(COURT_ACCESS, c.access) ? c.access : "public",
    surface: isOneOf(COURT_SURFACES, c.surface) ? c.surface : null,
    lights: c.lights,
    courtCount: c.courtCount,
    distanceLabel: miles == null ? "" : distanceLabel(miles),
    miles,
  };
}

/** Courts within `radius` miles, nearest first, then by name. */
export function nearbyCourts(viewer: Point, courts: CourtRow[], radius: number): CourtCard[] {
  return courts
    .map((c) => courtCard(viewer, c))
    .filter((c) => c.miles != null && c.miles <= radius)
    .sort((a, b) => Math.round(a.miles!) - Math.round(b.miles!) || a.name.localeCompare(b.name) || a.courtId - b.courtId)
    .map(({ miles: _m, ...card }) => card);
}
