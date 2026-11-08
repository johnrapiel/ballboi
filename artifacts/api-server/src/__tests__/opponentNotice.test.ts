import { describe, expect, it } from "vitest";
import {
  answerRequest,
  isStranger,
  opponentNoticeBody,
  planOpponentNotices,
  wasThatYouBody,
} from "../services/push/opponentNotice";

// Opponent notice and "Was that you?" (Session G acceptance 23 to 26; decision 124).

const pending = { code: "ABCD2345", opponentClerkUserId: "c", status: "pending" as const, notifiedAt: null };

describe("planOpponentNotices", () => {
  it("tells a league mate Ball Boi is recording (23)", () => {
    const plan = planOpponentNotices({ recorderId: "a", players: [{ clerkUserId: "a" }, { clerkUserId: "b" }], request: null, beta: false });
    expect(plan).toEqual({ notice: ["b"], request: null });
  });

  it("asks a stranger 'Was that you?' instead (24)", () => {
    // The stranger's side of the match is an unlinked stand-in, so only the request goes out.
    const plan = planOpponentNotices({ recorderId: "a", players: [{ clerkUserId: "a" }, { clerkUserId: null }], request: pending, beta: false });
    expect(plan).toEqual({ notice: [], request: { code: "ABCD2345", to: "c" } });
  });

  it("asks at most once, and never after an answer (25)", () => {
    const players = [{ clerkUserId: "a" }, { clerkUserId: null }];
    expect(planOpponentNotices({ recorderId: "a", players, request: { ...pending, notifiedAt: new Date() }, beta: false }).request).toBeNull();
    expect(planOpponentNotices({ recorderId: "a", players, request: { ...pending, status: "yes" }, beta: false }).request).toBeNull();
    expect(planOpponentNotices({ recorderId: "a", players, request: { ...pending, status: "not_me" }, beta: false }).request).toBeNull();
  });

  it("sends nothing in the app for a placeholder (26)", () => {
    const plan = planOpponentNotices({ recorderId: "a", players: [{ clerkUserId: "a" }, { clerkUserId: null }], request: null, beta: false });
    expect(plan).toEqual({ notice: [], request: null });
  });

  it("sends no opponent notice during the beta (26, decision 85)", () => {
    const plan = planOpponentNotices({ recorderId: "a", players: [{ clerkUserId: "a" }, { clerkUserId: "b" }], request: null, beta: true });
    expect(plan.notice).toEqual([]);
  });

  it("tells every other player in doubles, once each, never the recorder", () => {
    const plan = planOpponentNotices({
      recorderId: "a",
      players: [{ clerkUserId: "a" }, { clerkUserId: "b" }, { clerkUserId: "c" }, { clerkUserId: "b" }],
      request: null,
      beta: false,
    });
    expect(plan.notice).toEqual(["b", "c"]);
  });
});

describe("isStranger", () => {
  it("is a stranger only without a league, a past match or an accepted match card", () => {
    const none = { connected: new Set<string>(), acceptedPlanWith: new Set<string>() };
    expect(isStranger({ opponentClerkUserId: "c", ...none })).toBe(true);
    expect(isStranger({ opponentClerkUserId: "c", ...none, connected: new Set(["c"]) })).toBe(false);
    expect(isStranger({ opponentClerkUserId: "c", ...none, acceptedPlanWith: new Set(["c"]) })).toBe(false);
  });
});

describe("answerRequest (the link states)", () => {
  it("pending moves to yes or not me", () => {
    expect(answerRequest("pending", "yes")).toEqual({ ok: true, status: "yes" });
    expect(answerRequest("pending", "not_me")).toEqual({ ok: true, status: "not_me" });
  });

  it("the same answer twice is fine", () => {
    expect(answerRequest("yes", "yes")).toEqual({ ok: true, status: "yes" });
    expect(answerRequest("not_me", "not_me")).toEqual({ ok: true, status: "not_me" });
  });

  it("an answer can't be swapped", () => {
    expect(answerRequest("yes", "not_me").ok).toBe(false);
    expect(answerRequest("not_me", "yes").ok).toBe(false);
  });
});

describe("copy", () => {
  it("matches the spec", () => {
    expect(wasThatYouBody("John")).toBe("John recorded a match with you. Was that you?");
    expect(opponentNoticeBody("John")).toBe("John started recording your match.");
  });
});
