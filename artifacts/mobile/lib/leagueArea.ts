// A league's area (finding 19, decision 182): a town or ZIP, required for a
// new league with its name. Pure helpers for the New league form and cards.

export interface PlaceArea {
  zip: string;
  town: string;
  state: string;
}

/** "Wappingers Falls, NY". */
export const areaLabel = (a: PlaceArea | null | undefined): string | null => (a ? `${a.town}, ${a.state}` : null);

/** What the Area field starts with: your home area's town, or your home ZIP. */
export function prefillArea(me: { area: PlaceArea | null; homeZip: string | null } | null | undefined): string {
  return areaLabel(me?.area) ?? me?.homeZip ?? "";
}

/** Where the Area field stands: empty, being checked, found, or not found. */
export type AreaCheck = { state: "empty" } | { state: "checking" } | { state: "found"; area: PlaceArea } | { state: "error"; message: string };

/**
 * Why Create league is off, for VoiceOver, or null when it's on. Both
 * missing: "Add a league name and area to create it".
 */
export function createLeagueBlocker(name: string, area: AreaCheck): string | null {
  const noName = !name.trim();
  if (area.state === "empty") return noName ? "Add a league name and area to create it" : "Add the league's area to create it";
  if (noName) return "Add a league name to create it";
  if (area.state === "checking") return "Checking the league's area";
  if (area.state === "error") return "Check the league's area to create it";
  return null;
}
