// A league's area (finding 19, decision 182): the town or ZIP it plays around,
// required for a new league. Resolved like a player's home area
// (lib/discoverArea.ts): a US ZIP's town, state and center. A town resolves to
// its first ZIP, so the same place always lands on the same point.

import zipcodes from "zipcodes";
import { areaForZip, milesBetween, roundPoint, type Area, type Point } from "./discoverArea.js";

export const AREA_MISSING = "Add the league's area: a town or ZIP.";
export const NAME_MISSING = "Give your league a name.";
export const AREA_NOT_FOUND = "We couldn't find that town or ZIP. Check it and try again.";
export const AREA_NEEDS_STATE = "More than one town has that name. Add the state, for example Springfield, IL.";

export type AreaResult = { ok: true; area: Area } | { ok: false; error: string };

type ZipRow = { zip: string; latitude: number; longitude: number; city: string; state: string; country: string };

let towns: Map<string, ZipRow[]> | null = null;

/** Every US ZIP by upper-case town name, built once. */
function townIndex(): Map<string, ZipRow[]> {
  if (towns) return towns;
  towns = new Map();
  const codes = (zipcodes as unknown as { codes: Record<string, ZipRow> }).codes;
  for (const row of Object.values(codes)) {
    if (row.country !== "US" || !/^\d{5}$/.test(row.zip) || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) continue;
    const key = row.city.toUpperCase();
    const list = towns.get(key);
    if (list) list.push(row);
    else towns.set(key, [row]);
  }
  for (const list of towns.values()) list.sort((a, b) => a.zip.localeCompare(b.zip));
  return towns;
}

const toArea = (r: ZipRow): Area => ({
  zip: r.zip,
  town: r.city,
  state: r.state,
  point: roundPoint({ latitude: r.latitude, longitude: r.longitude }),
});

/**
 * A typed town or ZIP: "12590", "Wappingers Falls", "Wappingers Falls, NY" or
 * "Wappingers Falls NY". A town in more than one state picks the one nearest
 * `near` (the person's own home area) when given, and otherwise asks for the state.
 */
export function areaForPlace(text: unknown, near?: Point | null): AreaResult {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: AREA_MISSING };
  const q = text.trim().replace(/\s+/g, " ");
  if (/^\d{5}$/.test(q)) {
    const area = areaForZip(q);
    return area ? { ok: true, area } : { ok: false, error: AREA_NOT_FOUND };
  }
  const withState = /^(.+?)[,\s]+([A-Za-z]{2})$/.exec(q);
  const index = townIndex();
  const tryTown = (town: string, state?: string): ZipRow[] => {
    const rows = index.get(town.replace(/,$/, "").trim().toUpperCase()) ?? [];
    return state ? rows.filter((r) => r.state === state.toUpperCase()) : rows;
  };
  let rows = withState ? tryTown(withState[1], withState[2]) : [];
  if (!rows.length) rows = tryTown(q);
  if (!rows.length) return { ok: false, error: AREA_NOT_FOUND };
  const states = new Set(rows.map((r) => r.state));
  if (states.size > 1) {
    if (!near) return { ok: false, error: AREA_NEEDS_STATE };
    const nearest = [...rows].sort(
      (a, b) =>
        milesBetween(near, { latitude: a.latitude, longitude: a.longitude }) -
        milesBetween(near, { latitude: b.latitude, longitude: b.longitude }),
    )[0];
    rows = rows.filter((r) => r.state === nearest.state);
  }
  return { ok: true, area: toArea(rows[0]) };
}

/** The columns to store for a league's area. */
export function areaColumns(area: Area) {
  return {
    areaZip: area.zip,
    areaTown: area.town,
    areaState: area.state,
    areaLatitude: area.point.latitude,
    areaLongitude: area.point.longitude,
  };
}

/** What the app sees: the town, state and ZIP, or null for a league made before areas. */
export function leagueAreaView(l: { areaZip?: string | null; areaTown?: string | null; areaState?: string | null }) {
  return l.areaZip && l.areaTown && l.areaState ? { zip: l.areaZip, town: l.areaTown, state: l.areaState } : null;
}

/** The raw area columns stay out of API responses; `area` carries them. */
export function withoutAreaColumns<T extends Record<string, unknown>>(l: T) {
  const { areaZip: _z, areaTown: _t, areaState: _s, areaLatitude: _la, areaLongitude: _lo, ...rest } = l;
  return { ...rest, area: leagueAreaView(l as { areaZip?: string | null; areaTown?: string | null; areaState?: string | null }) };
}
