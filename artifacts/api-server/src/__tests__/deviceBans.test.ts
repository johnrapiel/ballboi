import { describe, expect, it } from "vitest";
import { parseBits } from "../services/deviceBans/appleDeviceCheck";
import { checkInAction, deviceBanLabel, validDeviceToken } from "../services/deviceBans/plan";

const base = { phoneMarked: false, ownBanActive: false, ownBanUndone: false, accountBanned: false };

describe("device bans (acceptance 38)", () => {
  it("a new account on a banned phone is banned too", () => {
    expect(checkInAction({ ...base, phoneMarked: true })).toBe("block");
  });

  it("other phones aren't affected", () => {
    expect(checkInAction(base)).toBe("ok");
  });

  it("the banned account's phone gets marked, even if it wasn't known when the ban was made", () => {
    expect(checkInAction({ ...base, ownBanActive: true, accountBanned: true })).toBe("mark");
    expect(checkInAction({ ...base, ownBanActive: true, accountBanned: true, phoneMarked: true })).toBe("ok");
  });

  it("an undone phone ban clears an old mark", () => {
    expect(checkInAction({ ...base, phoneMarked: true, ownBanUndone: true })).toBe("clear");
  });

  it("an already-banned account isn't banned twice", () => {
    expect(checkInAction({ ...base, phoneMarked: true, accountBanned: true })).toBe("ok");
  });

  it("reads Apple's answer, including the never-set case", () => {
    expect(parseBits('{"bit0":true,"bit1":false,"last_update_time":"2026-11"}')).toEqual({ bit0: true, bit1: false });
    expect(parseBits("Failed to find bit state")).toEqual({ bit0: false, bit1: false });
  });

  it("only sends Apple real-looking tokens", () => {
    expect(validDeviceToken("AgAAAI8xK2ZyM0tVb0dIV2lZd0hKcmxxN3BPZzRnbE5uRHpBS1E9PQ==")).toBe(true);
    expect(validDeviceToken("short")).toBe(false);
    expect(validDeviceToken("<script>alert(1)</script>xxxxxxxxxxxxx")).toBe(false);
    expect(validDeviceToken(42)).toBe(false);
  });

  it("says in the admin queue what happened", () => {
    expect(deviceBanLabel("caught", "yes")).toBe("New account on a banned phone");
    expect(deviceBanLabel("banned", "yes")).toBe("Banned, and their phone");
    expect(deviceBanLabel("banned", "no")).toMatch(/next time/);
  });
});
