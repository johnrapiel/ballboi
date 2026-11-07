// The court directory (spec: Discover > Court directory; F4). Pure rules;
// lib/courtRepo.ts fetches and saves.
//
// - A searchable list, nearest first: "Beacon Courts · ~3 mi". No map.
// - "Add a court" takes a name and an address. The address needs its 5-digit
//   ZIP, which places the court (at the ZIP's center: always approximate).
// - The same name in the same ZIP is the same court: adding it again picks
//   the one that's there.

import { areaForZip, distanceLabel, milesBetween, type Point } from "./discoverArea.js";

export interface CourtRow {
  id: number;
  name: string;
  address: string;
  zip: string;
  town: string | null;
  latitude: number;
  longitude: number;
}

export interface CourtCard {
  courtId: number;
  name: string;
  address: string;
  /** "~3 mi", or null when you have no area yet. */
  distance: string | null;
}

export interface NewCourt {
  name: string;
  address: string;
  zip: string;
  town: string;
  point: Point;
}

/** How many courts one account can add in a day, so the list stays real. */
export const DAILY_COURT_LIMIT = 10;
/** The directory shows courts this close by default. */
export const COURT_RADIUS = 30;
export const MAX_COURTS = 50;

export const BAD_ADDRESS = "We couldn't find that address. Add the court's 5-digit ZIP, like \"Memorial Park, Beacon NY 12508\".";

const LINKISH = /(https?:\/\/|www\.|\.(com|net|org|io|co)\b|@|\d{3}[\s.-]?\d{3}[\s.-]?\d{4})/i;

/** Checks a new court. Returns the clean court, or the problem in the player's words. */
export function parseNewCourt(body: unknown): NewCourt | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2) return { error: "Give the court a name." };
  if (name.length > 60) return { error: "Keep the name to 60 characters." };
  const address = typeof b.address === "string" ? b.address.trim().replace(/\s+/g, " ") : "";
  if (address.length < 5) return { error: BAD_ADDRESS };
  if (address.length > 120) return { error: "Keep the address to 120 characters." };
  if (LINKISH.test(name) || LINKISH.test(address)) return { error: "Court names and addresses can't include links, emails or phone numbers." };
  // The last 5-digit number is the ZIP ("12 Main St, Beacon NY 12508" or "12508-1234").
  const zips = [...address.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)].map((m) => m[1]);
  const zip = zips[zips.length - 1];
  const area = zip ? areaForZip(zip) : null;
  if (!area) return { error: BAD_ADDRESS };
  return { name, address, zip: area.zip, town: area.town, point: area.point };
}

const normalized = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(tennis|courts?|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

/** An existing court that's the one being added: the same name in the same ZIP. */
export function findSameCourt(existing: CourtRow[], add: Pick<NewCourt, "name" | "zip">): CourtRow | null {
  const key = normalized(add.name);
  return existing.find((c) => c.zip === add.zip && normalized(c.name) === key) ?? null;
}

/** Search words all appear in the name or address. */
export function matchesSearch(c: Pick<CourtRow, "name" | "address">, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${c.name} ${c.address}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function courtCard(viewer: Point | null, c: CourtRow): CourtCard & { miles: number | null } {
  const miles = viewer ? milesBetween(viewer, { latitude: c.latitude, longitude: c.longitude }) : null;
  return { courtId: c.id, name: c.name, address: c.address, distance: miles == null ? null : distanceLabel(miles), miles };
}

/** Courts nearest first (then by name), matching the search, at most MAX_COURTS. */
export function listCourts(viewer: Point | null, courts: CourtRow[], q: string): CourtCard[] {
  return courts
    .filter((c) => !q || matchesSearch(c, q))
    .map((c) => courtCard(viewer, c))
    .sort((a, b) => (a.miles ?? 1e9) - (b.miles ?? 1e9) || a.name.localeCompare(b.name) || a.courtId - b.courtId)
    .slice(0, MAX_COURTS)
    .map(({ miles: _m, ...card }) => card);
}
