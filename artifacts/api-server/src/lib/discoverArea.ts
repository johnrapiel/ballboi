// Where a player is, for Discover (spec: Discover > Location and privacy).
// Discover is local: every result is bounded by distance from the player's
// home area, and distances are only ever shown approximately ("~4 mi away").
//
// A home area is a zip code. Its point is the zip's center from the US Census
// Bureau's ZIP Code Tabulation Areas (the us-zips package, MIT, free), or the
// rounded "Use my location" point when the player gave one. Neither is an
// exact address.

import zipList from "us-zips/key-value";

export type Point = { latitude: number; longitude: number };

let zipCenters: Map<string, Point> | null = null;

/** The center of a five-digit zip code, or null for one the Census list doesn't have (PO boxes, new zips). */
export function zipCenter(zip: string | null | undefined): Point | null {
  if (!zip || !/^\d{5}$/.test(zip)) return null;
  if (!zipCenters) zipCenters = new Map(zipList.map(([z, p]) => [z, { latitude: p.latitude, longitude: p.longitude }]));
  return zipCenters.get(zip) ?? null;
}

/** Two decimals, about a kilometer: never an exact spot. */
export function roundPoint(p: Point): Point {
  return { latitude: Math.round(p.latitude * 100) / 100, longitude: Math.round(p.longitude * 100) / 100 };
}

/**
 * The point Discover measures from for a home area: the rounded device point
 * when the player used "Use my location", otherwise the zip's center.
 */
export function homeAreaPoint(area: { zip: string | null; latitude: number | null; longitude: number | null }): Point | null {
  if (area.latitude != null && area.longitude != null) return roundPoint({ latitude: area.latitude, longitude: area.longitude });
  const center = zipCenter(area.zip);
  return center ? roundPoint(center) : null;
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

/** A latitude and longitude box around a point that holds every spot within `miles`, for a quick database filter. */
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

/** Search radius choices in miles (spec: 5 / 10 / 15 / 30, 10 by default, 30 at most). */
export const RADIUS_OPTIONS = [5, 10, 15, 30] as const;
export type RadiusMiles = (typeof RADIUS_OPTIONS)[number];
export const DEFAULT_RADIUS: RadiusMiles = 10;
export const MAX_RADIUS: RadiusMiles = 30;

export function parseRadius(raw: unknown): RadiusMiles {
  const n = Number(raw);
  return (RADIUS_OPTIONS as readonly number[]).includes(n) ? (n as RadiusMiles) : DEFAULT_RADIUS;
}

/**
 * Whole miles for the card, never finer: "Under 1 mi away" or "~4 mi away".
 */
export function distanceLabel(miles: number): string {
  if (miles < 1) return "Under 1 mi away";
  return `~${Math.round(miles)} mi away`;
}
