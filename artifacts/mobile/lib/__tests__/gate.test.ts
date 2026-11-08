import { describe, expect, it } from "vitest";

import { gateFor, gateRedirect, inviteFromPath, type GateInput } from "@/lib/gate";

const base: GateInput = { signedIn: true, hasUser: true, account: "ok", aged: true, onboarded: true };

describe("gateFor", () => {
  it("goes blocked, then age check, then onboarding, then the app", () => {
    expect(gateFor({ ...base, signedIn: false })).toBe("signedOut");
    expect(gateFor({ ...base, account: "blocked", aged: false, onboarded: false })).toBe("blocked");
    expect(gateFor({ ...base, aged: false, onboarded: false })).toBe("ageCheck");
    expect(gateFor({ ...base, onboarded: false })).toBe("onboarding");
    expect(gateFor(base)).toBe("app");
  });

  it("waits for the account check before the first step, so a banned re-signup never sees onboarding", () => {
    expect(gateFor({ ...base, account: "pending", aged: false, onboarded: false })).toBe("checking");
    expect(gateFor({ ...base, account: "pending", onboarded: false })).toBe("checking");
  });

  it("lets people already in the app in while the check runs", () => {
    expect(gateFor({ ...base, account: "pending" })).toBe("app");
    expect(gateFor({ ...base, account: "blocked" })).toBe("blocked");
  });

  it("waits for the Clerk user", () => {
    expect(gateFor({ ...base, hasUser: false })).toBe("checking");
  });
});

describe("inviteFromPath", () => {
  it("reads league and Quick match invite links", () => {
    expect(inviteFromPath("/join/QQBU4MBY")).toEqual({ kind: "league", code: "QQBU4MBY" });
    expect(inviteFromPath("/record/invite/AB12")).toEqual({ kind: "match", code: "AB12" });
    expect(inviteFromPath("/join/QQBU4MBY?x=1")).toEqual({ kind: "league", code: "QQBU4MBY" });
  });

  it("ignores every other path", () => {
    expect(inviteFromPath("/")).toBeNull();
    expect(inviteFromPath("/join")).toBeNull();
    expect(inviteFromPath("/league/5")).toBeNull();
    expect(inviteFromPath("/record/quick")).toBeNull();
  });
});

describe("gateRedirect", () => {
  it("sends a signed-in person without a birthday from a league invite to the age check, keeping the link", () => {
    expect(gateRedirect("ageCheck", ["join", "[code]"], "/join/ABC")).toEqual({
      to: "/age-check",
      keep: { kind: "league", code: "ABC" },
    });
  });

  it("keeps a Quick match invite through onboarding", () => {
    expect(gateRedirect("onboarding", ["record", "invite", "[code]"], "/record/invite/XYZ")).toEqual({
      to: "/onboarding",
      keep: { kind: "match", code: "XYZ" },
    });
  });

  it("holds every other screen behind the age check and onboarding", () => {
    expect(gateRedirect("ageCheck", ["(tabs)"], "/")).toEqual({ to: "/age-check", keep: null });
    expect(gateRedirect("ageCheck", ["league", "[leagueId]"], "/league/5")).toEqual({ to: "/age-check", keep: null });
    expect(gateRedirect("onboarding", ["messages"], "/messages")).toEqual({ to: "/onboarding", keep: null });
    expect(gateRedirect("ageCheck", ["age-check"], "/age-check")).toBeNull();
    expect(gateRedirect("onboarding", ["onboarding", "home"], "/onboarding/home")).toBeNull();
  });

  it("keeps a blocked account on the blocked screen or Delete account", () => {
    expect(gateRedirect("blocked", ["onboarding"], "/onboarding")).toEqual({ to: "/account-blocked", keep: null });
    expect(gateRedirect("blocked", ["join", "[code]"], "/join/ABC")).toEqual({ to: "/account-blocked", keep: null });
    expect(gateRedirect("blocked", ["account-blocked"], "/account-blocked")).toBeNull();
    expect(gateRedirect("blocked", ["delete-account"], "/delete-account")).toBeNull();
  });

  it("lets signed-out people see invites and Welcome, and nothing else", () => {
    expect(gateRedirect("signedOut", ["join", "[code]"], "/join/ABC")).toBeNull();
    expect(gateRedirect("signedOut", ["record", "invite", "[code]"], "/record/invite/X")).toBeNull();
    expect(gateRedirect("signedOut", ["(auth)", "email"], "/email")).toBeNull();
    expect(gateRedirect("signedOut", ["eighteen-plus"], "/eighteen-plus")).toBeNull();
    expect(gateRedirect("signedOut", ["(tabs)"], "/")).toEqual({ to: "/(auth)/welcome", keep: null });
    expect(gateRedirect("signedOut", ["delete-account"], "/delete-account")).toEqual({ to: "/(auth)/welcome", keep: null });
  });

  it("moves people in the app off sign-in, the age check and the blocked screen", () => {
    expect(gateRedirect("app", ["(auth)", "email"], "/email")).toEqual({ to: "/(tabs)", keep: null });
    expect(gateRedirect("app", ["age-check"], "/age-check")).toEqual({ to: "/(tabs)", keep: null });
    expect(gateRedirect("app", ["account-blocked"], "/account-blocked")).toEqual({ to: "/(tabs)", keep: null });
    expect(gateRedirect("app", ["join", "[code]"], "/join/ABC")).toBeNull();
    expect(gateRedirect("app", ["onboarding", "intent"], "/onboarding/intent")).toBeNull();
  });

  it("never redirects while checking or from Not Found", () => {
    expect(gateRedirect("checking", ["(tabs)"], "/")).toBeNull();
    expect(gateRedirect("ageCheck", ["+not-found"], "/nope")).toBeNull();
  });
});
