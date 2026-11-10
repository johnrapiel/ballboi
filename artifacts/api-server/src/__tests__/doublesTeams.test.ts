import { describe, it, expect } from "vitest";
import {
  andJoin,
  canLetInForPartner,
  chatCardText,
  chatTitleFor,
  checkRequest,
  checkRespond,
  doublesResultLine,
  dueChatCards,
  expiresAt,
  firstName,
  isExpired,
  isFixedDoubles,
  noticeText,
  partnerModeOf,
  requestCandidates,
  requestsEndedByTeam,
  shortName,
  teamName,
  unpairedMembers,
  versusLine,
  type PartnerRequest,
} from "../lib/doublesTeams.js";
import { addDays, localDate, localHour } from "../lib/leagueCalendar.js";
import { pairKey } from "../lib/pairing.js";

// Doubles partner rules (doubles flow review, John, Nov 9).

const fixed = { leagueType: "doubles", partnerMode: "fixed", endedAt: null };
const req = (id: number, from: number, to: number, extra: Partial<PartnerRequest> = {}): PartnerRequest => ({
  id,
  leagueId: 1,
  fromPlayerId: from,
  toPlayerId: to,
  status: "pending",
  createdAt: new Date("2026-11-10T12:00:00Z"),
  respondedAt: null,
  noticeSeenAt: null,
  ...extra,
});

describe("D1: partner types", () => {
  it("reads Fixed or Rotating; a doubles league with no setting rotates", () => {
    expect(partnerModeOf({ partnerMode: "fixed" })).toBe("fixed");
    expect(partnerModeOf({ partnerMode: null })).toBe("rotating");
    expect(isFixedDoubles({ leagueType: "doubles", partnerMode: "fixed" })).toBe(true);
    expect(isFixedDoubles({ leagueType: "singles", partnerMode: "fixed" })).toBe(false);
  });
});

describe("names (D3, D6, D7, D8)", () => {
  it("names teams in standings with full names", () => {
    expect(teamName(["John Rapiel", "Sam Lee"])).toBe("John Rapiel & Sam Lee");
  });

  it("writes the match line from your side: You and Sam vs. Jo and Lee", () => {
    expect(versusLine("Sam Lee", ["Jo Park", "Lee King"])).toBe("You and Sam vs. Jo and Lee");
    expect(versusLine(null, ["Jo Park"])).toBe("You vs. Jo");
  });

  it("titles the chat for each member: You, Sam, Jo and Lee · Week 3", () => {
    expect(chatTitleFor(["Sam Lee", "Jo Park", "Lee King"], 3)).toBe("You, Sam, Jo and Lee · Week 3");
    expect(andJoin(["A", "B"])).toBe("A and B");
  });

  it("writes the result in team names from the winners' side", () => {
    expect(doublesResultLine(["John Rapiel", "Sam Lee"], ["Jo Park", "Lee King"], "6-3, 6-4")).toBe("John R. & Sam L. def. Jo P. & Lee K. 6-3, 6-4");
    expect(shortName("Cher")).toBe("Cher");
    expect(firstName("  ")).toBe("Player");
  });
});

describe("D9: requests", () => {
  const base = {
    league: fixed,
    firstRoundOut: false,
    fromPlayerId: 1,
    toPlayerId: 2,
    activePlayerIds: [1, 2, 3, 4],
    teamed: new Set<number>(),
    pending: [] as PartnerRequest[],
    blocked: new Set<string>(),
  };

  it("lets a member without a partner ask another", () => {
    expect(checkRequest(base)).toEqual({ ok: true });
  });

  it("refuses with plain words", () => {
    expect(checkRequest({ ...base, league: { ...fixed, partnerMode: "rotating" } })).toMatchObject({ ok: false, status: 409 });
    expect(checkRequest({ ...base, fromPlayerId: null })).toMatchObject({ status: 403 });
    expect(checkRequest({ ...base, firstRoundOut: true })).toMatchObject({ error: expect.stringMatching(/first round went out/) });
    expect(checkRequest({ ...base, toPlayerId: 1 })).toMatchObject({ status: 400 });
    expect(checkRequest({ ...base, teamed: new Set([1]) })).toMatchObject({ error: "You already have a partner." });
    expect(checkRequest({ ...base, teamed: new Set([2]) })).toMatchObject({ error: "They already have a partner." });
    expect(checkRequest({ ...base, league: { ...fixed, endedAt: new Date() } })).toMatchObject({ error: "This league has ended." });
  });

  it("never says a block is a block", () => {
    const r = checkRequest({ ...base, blocked: new Set([pairKey(1, 2)]) });
    expect(r).toEqual({ ok: false, status: 404, error: "This player isn't available to team up." });
    expect(checkRequest({ ...base, toPlayerId: 9 })).toEqual(r);
  });

  it("expires after 48 hours", () => {
    const r = req(1, 1, 2);
    expect(expiresAt(r).toISOString()).toBe("2026-11-12T12:00:00.000Z");
    expect(isExpired(r, new Date("2026-11-12T11:59:00Z"))).toBe(false);
    expect(isExpired(r, new Date("2026-11-12T12:00:00Z"))).toBe(true);
    expect(isExpired({ ...r, status: "accepted" }, new Date("2026-12-01T00:00:00Z"))).toBe(false);
  });

  it("only the player asked can answer, while it's pending and inside 48 hours", () => {
    const at = new Date("2026-11-11T00:00:00Z");
    expect(checkRespond(req(1, 1, 2), [2], at)).toEqual({ ok: true });
    expect(checkRespond(req(1, 1, 2), [1], at)).toMatchObject({ status: 404 });
    expect(checkRespond(req(1, 1, 2, { status: "declined" }), [2], at)).toMatchObject({ status: 409 });
    expect(checkRespond(req(1, 1, 2), [2], new Date("2026-11-13T00:00:00Z"))).toMatchObject({ error: "This request ran out after 48 hours." });
  });

  it("words each ending for the sender; Cancel and Accept need no notice", () => {
    expect(noticeText("declined", "Sam Lee")).toMatch(/^Sam Lee can't team up this season\. You're back on Looking for a partner/);
    expect(noticeText("expired", "Sam Lee")).toMatch(/didn't answer your request in 48 hours/);
    expect(noticeText("taken", "Sam Lee")).toMatch(/teamed up with someone else/);
    expect(noticeText("cancelled", "Sam Lee")).toBeNull();
    expect(noticeText("accepted", "Sam Lee")).toBeNull();
  });

  it("a new team ends every other pending request touching either partner", () => {
    const list = [req(1, 1, 2), req(2, 3, 1), req(3, 4, 5), req(4, 2, 6, { status: "declined" })];
    expect(requestsEndedByTeam(list, [1, 2], list[0]).map((r) => r.id)).toEqual([2]);
  });
});

describe("D2, D4, D9: who's without a partner", () => {
  const m = (id: number, level: number, looking = false) => ({ id, name: `P${id}`, level, lookingForPartnerAt: looking ? new Date() : null });

  it("splits Manage's unpaired list into Needs a partner, Looking for a partner and the rest, by level", () => {
    const members = [m(1, 3.0), m(2, 4.0, true), m(3, 3.5), m(5, 4.5), m(6, 4.5)];
    const teams = [
      { id: 10, player1Id: 1, player2Id: 9, dissolvedAt: new Date(), dissolvedReason: "partner_left" },
      { id: 11, player1Id: 5, player2Id: 6, dissolvedAt: null, dissolvedReason: null },
    ];
    expect(unpairedMembers(members, teams).map((u) => [u.member.id, u.kind])).toEqual([
      [2, "looking"],
      [3, "no_partner"],
      [1, "needs_partner"],
    ]);
  });

  it("lists who you can ask: no partner yet, not you, never a block", () => {
    const members = [m(1, 3), m(2, 3), m(3, 3), m(4, 3)];
    expect(requestCandidates(members, new Set([3]), 1, new Set([pairKey(1, 4)])).map((x) => x.id)).toEqual([2]);
  });

  it("D4: an Open fixed-partner league lets a waitlisted player in only for someone who needs a partner", () => {
    const open = { leagueType: "doubles", partnerMode: "fixed", visibility: "open" };
    expect(canLetInForPartner(open, true)).toBe(true);
    expect(canLetInForPartner(open, false)).toBe(false);
    expect(canLetInForPartner({ ...open, visibility: "private" }, true)).toBe(false);
    expect(canLetInForPartner({ ...open, partnerMode: "rotating" }, true)).toBe(false);
  });
});

describe("D6: the chat's cards", () => {
  const local = { date: localDate, hour: localHour, addDays };
  const zone = "America/New_York";
  // Thursday Nov 12, 6 PM in New York.
  const at = new Date("2026-11-12T23:00:00Z");

  it("the day before from 8 AM on the league's clock", () => {
    expect(dueChatCards({ scheduledAt: at, scored: false }, zone, new Date("2026-11-11T12:30:00Z"), local)).toEqual([]); // 7:30 AM
    expect(dueChatCards({ scheduledAt: at, scored: false }, zone, new Date("2026-11-11T13:05:00Z"), local)).toEqual(["day_before"]);
    expect(chatCardText("day_before", at, zone)).toBe("Still on for tomorrow at 6:00 PM? Say here if anything changes.");
  });

  it("Did it happen? 3 hours after the start with no score, never with one or without a time", () => {
    expect(dueChatCards({ scheduledAt: at, scored: false }, zone, new Date("2026-11-13T01:59:00Z"), local)).toEqual([]);
    expect(dueChatCards({ scheduledAt: at, scored: false }, zone, new Date("2026-11-13T02:00:00Z"), local)).toEqual(["did_it_happen"]);
    expect(dueChatCards({ scheduledAt: at, scored: true }, zone, new Date("2026-11-13T02:00:00Z"), local)).toEqual([]);
    expect(dueChatCards({ scheduledAt: null, scored: false }, zone, new Date("2026-11-13T02:00:00Z"), local)).toEqual([]);
  });
});
