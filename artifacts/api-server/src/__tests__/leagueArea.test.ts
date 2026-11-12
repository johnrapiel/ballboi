import { describe, expect, it } from "vitest";
import { AREA_MISSING, AREA_NEEDS_STATE, AREA_NOT_FOUND, areaForPlace, leagueAreaView } from "../lib/leagueArea.js";

// A league's area (finding 19, decision 182): a town or ZIP, resolved like a home area.

describe("areaForPlace", () => {
  it("finds a ZIP", () => {
    const r = areaForPlace("12590");
    expect(r.ok && r.area).toMatchObject({ zip: "12590", town: "Wappingers Falls", state: "NY" });
  });

  it("finds a town, with or without its state, in any case", () => {
    for (const q of ["Wappingers Falls", "wappingers falls, ny", "Wappingers Falls NY", "  Wappingers   Falls,NY "]) {
      const r = areaForPlace(q);
      expect(r.ok && r.area.zip, q).toBe("12590");
    }
  });

  it("asks for the state when a town name repeats, unless it knows where you are", () => {
    expect(areaForPlace("Springfield")).toEqual({ ok: false, error: AREA_NEEDS_STATE });
    const nearIllinois = areaForPlace("Springfield", { latitude: 39.8, longitude: -89.6 });
    expect(nearIllinois.ok && nearIllinois.area.state).toBe("IL");
    const ma = areaForPlace("Springfield, MA");
    expect(ma.ok && ma.area.state).toBe("MA");
  });

  it("says plainly when it's missing or unknown", () => {
    expect(areaForPlace("")).toEqual({ ok: false, error: AREA_MISSING });
    expect(areaForPlace(undefined)).toEqual({ ok: false, error: AREA_MISSING });
    expect(areaForPlace("00000")).toEqual({ ok: false, error: AREA_NOT_FOUND });
    expect(areaForPlace("Nowhereville Zzz")).toEqual({ ok: false, error: AREA_NOT_FOUND });
  });
});

describe("leagueAreaView", () => {
  it("is null for a league made before areas", () => {
    expect(leagueAreaView({ areaZip: null, areaTown: null, areaState: null })).toBeNull();
    expect(leagueAreaView({})).toBeNull();
  });
});
