import { describe, expect, it } from "vitest";

import { accessFrom, canDeliver, IOS_STATUS, routeForPushLink, shouldAskNow, showOffLine } from "../notificationAccess";

// Notification permission (Session G acceptance 18 to 21; decision 125).

const ios = (status: number) => ({ granted: status === IOS_STATUS.authorized, status: "x", ios: { status } });

describe("accessFrom", () => {
  it("reads iOS's own status", () => {
    expect(accessFrom(ios(IOS_STATUS.notDetermined))).toBe("notAsked");
    expect(accessFrom(ios(IOS_STATUS.provisional))).toBe("quiet");
    expect(accessFrom(ios(IOS_STATUS.authorized))).toBe("full");
    expect(accessFrom(ios(IOS_STATUS.ephemeral))).toBe("full");
    expect(accessFrom(ios(IOS_STATUS.denied))).toBe("off");
  });

  it("falls back to the cross-platform fields", () => {
    expect(accessFrom({ granted: true, status: "granted" })).toBe("full");
    expect(accessFrom({ granted: false, status: "denied" })).toBe("off");
    expect(accessFrom({ granted: false, status: "undetermined" })).toBe("notAsked");
  });
});

describe("the prompt triggers (G3)", () => {
  it("asks at the first trigger while iOS can still ask", () => {
    expect(shouldAskNow("notAsked", false)).toBe(true);
    // Quiet notifications from sign-in can still be upgraded.
    expect(shouldAskNow("quiet", false)).toBe(true);
  });

  it("never asks twice on a phone", () => {
    expect(shouldAskNow("notAsked", true)).toBe(false);
    expect(shouldAskNow("quiet", true)).toBe(false);
  });

  it("never asks once the player said yes in full, or no", () => {
    expect(shouldAskNow("full", false)).toBe(false);
    expect(shouldAskNow("off", false)).toBe(false);
  });
});

describe("delivery and the Home line", () => {
  it("sends the push token whenever iOS will deliver", () => {
    expect(canDeliver("quiet")).toBe(true);
    expect(canDeliver("full")).toBe(true);
    expect(canDeliver("notAsked")).toBe(false);
    expect(canDeliver("off")).toBe(false);
  });

  it("shows the Home line only when notifications are off", () => {
    expect(showOffLine("off")).toBe(true);
    expect(showOffLine("quiet")).toBe(false);
    expect(showOffLine("full")).toBe(false);
    expect(showOffLine(null)).toBe(false);
  });
});

describe("routeForPushLink", () => {
  it("opens a message push in its chat", () => {
    expect(routeForPushLink("/conversation/42")).toBe("/conversation/42");
    expect(routeForPushLink("/messages/42")).toBe("/conversation/42");
    expect(routeForPushLink("/conversation/group/7")).toBe("/conversation/group/7");
    expect(routeForPushLink("/conversation/group/x")).toBe("/");
  });

  it("maps the API's links to the app's screens", () => {
    expect(routeForPushLink("/matches/7")).toBe("/match/7");
    expect(routeForPushLink("/league/3")).toBe("/league/3");
    expect(routeForPushLink("/leagues/3")).toBe("/league/3");
    expect(routeForPushLink("/messages")).toBe("/messages");
    expect(routeForPushLink("/discover")).toBe("/discover");
    expect(routeForPushLink("/leagues")).toBe("/leagues");
  });

  it("opens Was that you? on the match invite screen", () => {
    expect(routeForPushLink("/record/invite/ABCD2345")).toBe("/record/invite/ABCD2345");
    expect(routeForPushLink("/record/invite/../../x")).toBe("/");
  });

  it("opens Home for anything else", () => {
    expect(routeForPushLink("/leagues/3/leave")).toBe("/");
    expect(routeForPushLink("https://example.com")).toBe("/");
    expect(routeForPushLink(undefined)).toBe("/");
    expect(routeForPushLink(12)).toBe("/");
  });
});
