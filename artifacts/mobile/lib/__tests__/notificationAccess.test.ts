import { describe, expect, it } from "vitest";

import { IOS_STATUS, accessFrom, canDeliver, shouldShowReason, showOffBanner } from "@/lib/notificationAccess";

const ios = (status: number, granted = false) => ({ granted, status: granted ? "granted" : "undetermined", ios: { status } });

describe("accessFrom", () => {
  it("reads each iOS status", () => {
    expect(accessFrom(ios(IOS_STATUS.notDetermined))).toBe("notAsked");
    expect(accessFrom(ios(IOS_STATUS.provisional, true))).toBe("quiet");
    expect(accessFrom(ios(IOS_STATUS.authorized, true))).toBe("full");
    expect(accessFrom(ios(IOS_STATUS.ephemeral, true))).toBe("full");
    expect(accessFrom({ granted: false, status: "denied", ios: { status: IOS_STATUS.denied } })).toBe("off");
  });

  it("falls back to the plain status off iOS", () => {
    expect(accessFrom({ granted: true, status: "granted" })).toBe("full");
    expect(accessFrom({ granted: false, status: "denied" })).toBe("off");
    expect(accessFrom({ granted: false, status: "undetermined" })).toBe("notAsked");
  });
});

describe("what the app does", () => {
  it("sends the push token only when iOS will deliver", () => {
    expect(canDeliver("quiet")).toBe(true);
    expect(canDeliver("full")).toBe(true);
    expect(canDeliver("notAsked")).toBe(false);
    expect(canDeliver("off")).toBe(false);
  });

  it("shows the reason screen once, and never after a full yes or a no", () => {
    expect(shouldShowReason("quiet", false)).toBe(true);
    expect(shouldShowReason("notAsked", false)).toBe(true);
    expect(shouldShowReason("quiet", true)).toBe(false);
    expect(shouldShowReason("full", false)).toBe(false);
    expect(shouldShowReason("off", false)).toBe(false);
  });

  it("shows the Home banner only when notifications are off", () => {
    expect(showOffBanner("off")).toBe(true);
    expect(showOffBanner("quiet")).toBe(false);
    expect(showOffBanner("notAsked")).toBe(false);
  });
});
