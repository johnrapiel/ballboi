// Where a player is, for Discover (spec: Discover > Location and privacy;
// F5: no travel mode). Discover always measures from the center of your home
// ZIP, never a device location, and shows only a town and an approximate
// distance ("~4 mi"), never an exact spot.

import zipcodes from "zipcodes";

export type Point = { latitude: number; longitude: number };

export interface Area {
  zip: string;
  town: string;
  state: string;
  point: Point;
}

/** The shown error for a ZIP we can't place (acceptance item 4). */
export const ZIP_NOT_FOUND = "We couldn't find that ZIP. Check it and try again.";

/** Two decimals, about a kilometer: never an exact spot. */
export function roundPoint(p: Point): Point {
  return { latitude: Math.round(p.latitude * 100) / 100, longitude: Math.round(p.longitude * 100) / 100 };
}

/** A US ZIP's town and center, or null when it's not five digits or not a real ZIP. */
export function areaForZip(zip: unknown): Area | null {
  if (typeof zip !== "string" || !/^\d{5}$/.test(zip.trim())) return null;
  const z = zipcodes.lookup(zip.trim());
  if (!z || z.country !== "US" || !Number.isFinite(z.latitude) || !Number.isFinite(z.longitude)) return null;
  return { zip: z.zip, town: z.city, state: z.state, point: roundPoint({ latitude: z.latitude, longitude: z.longitude }) };
}

const EARTH_RADIUS_MILES = 3958.8;

/** Straight-line miles between two points (haversine). */
export function milesBetween(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A box around a point that holds every spot within `miles`, for a quick database filter. */
export function boundingBox(center: Point, miles: number) {
  const dLat = miles / 69;
  const dLon = miles / (69 * Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180)));
  return {
    minLat: center.latitude - dLat,
    maxLat: center.latitude + dLat,
    minLon: center.longitude - dLon,
    maxLon: center.longitude + dLon,
  };
}

/** The distance chips (spec: 5 / 10 / 15 / 30, 10 by default, 30 at most), plus Custom from 1 to 30. */
export const RADIUS_STEPS = [5, 10, 15, 30] as const;
export const DEFAULT_RADIUS = 10;
export const MIN_RADIUS = 1;
export const MAX_RADIUS = 30;

/** A whole number of miles from 1 to 30, or the default for anything else. */
export function parseRadius(raw: unknown, fallback: number = DEFAULT_RADIUS): number {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Math.round(n)));
}

/** Whole miles, never finer, never zero: "~4 mi". Pairs with "away" on the player card. */
export function approxMiles(miles: number): number {
  return Math.max(1, Math.round(miles));
}

export function distanceLabel(miles: number): string {
  return `~${approxMiles(miles)} mi`;
}
