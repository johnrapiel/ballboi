import { describe, expect, it } from "vitest";

import { canLeadHome, heroIndex, isMatchToday, isRecordDay, splitRecordDay } from "@/lib/matchTiming";
import { matchSourceLabel } from "@/lib/recording/format";
import { openLead, rowSub, rowWhen, upcomingFromRecordable, upcomingList, type OpenInput } from "@/lib/upcoming";
import { upcomingActions } from "@/lib/upcomingDetail";

// Today's match leads (Wave 2 findings 63 and 64, John, Nov 14). Local times,
// so the tests read the same in any time zone they run in.
const now = new Date(2026, 10, 14, 9, 0); // Sat, Nov 14, 9 AM
const local = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString();
const ymd = (day: number) => `2026-11-${String(day).padStart(2, "0")}`;

const kristina = { name: "Kristina Novak", avatarUrl: "/objects/uploads/k" };
const open = (o: Partial<OpenInput> = {}): OpenInput => ({
  id: 7,
  startsAt: local(14, 18),
  format: "singles",
  courtName: "Memorial Park",
  status: "full",
  spotsLeft: 0,
  matchId: 501,
  others: [kristina],
  ...o,
});

describe("Home: an open match on its day leads (finding 63)", () => {
  const league = (day: number, h: number) => ({ kind: "league", scheduledAt: local(day, h) });

  it("today's open match leads with the card", () => {
    const items = [{ kind: "open", scheduledAt: local(14, 18) }, league(19, 18)];
    expect(heroIndex(items, now, (m) => canLeadHome(m, now))).toBe(0);
  });

  it("an open match on another day never takes the card from a non-open match", () => {
    const items = [{ kind: "open", scheduledAt: local(16, 18) }, league(19, 18)];
    expect(canLeadHome(items[0], now)).toBe(false);
    expect(heroIndex(items, now, (m) => canLeadHome(m, now))).toBe(1);
  });

  it("keeps heroIndex's rule: a match still ahead today leads over a past-due one", () => {
    const evening = new Date(2026, 10, 14, 20, 0);
    const items = [league(14, 18), { kind: "open", scheduledAt: local(14, 21) }];
    expect(heroIndex(items, evening, (m) => canLeadHome(m, evening))).toBe(1);
  });

  it("isMatchToday reads the day in the match's zone", () => {
    expect(isMatchToday({ scheduledAt: local(14, 18) }, now)).toBe(true);
    expect(isMatchToday({ scheduledAt: local(15, 18) }, now)).toBe(false);
    expect(isMatchToday({ scheduledAt: null }, now)).toBe(false);
  });
});

describe("Home: the open match card (finding 63)", () => {
  it("a full singles open match reads vs. its player, with Record, Message and the match", () => {
    const [m] = upcomingList({ open: [open()], now });
    expect(m).toMatchObject({ kind: "open", opponentName: "Kristina Novak", opponentPhoto: "/objects/uploads/k", matchId: 501, openStatus: "Full" });
    // The usual "You vs. Kristina": no special line.
    expect(openLead(m)).toBeNull();
    const actions = upcomingActions(m, { matchTimeAllowed: false, now });
    expect(actions).toMatchObject({ record: true, pastDue: false, doublesNote: false, enterScore: false });
  });

  it("past due, Enter score leads and Record becomes a link (decision 197)", () => {
    const [m] = upcomingList({ open: [open({ startsAt: local(14, 7) })], now });
    expect(upcomingActions(m, { matchTimeAllowed: false, now })).toMatchObject({ record: true, pastDue: true, enterScore: true });
  });

  it("a full doubles open match shows the other players together, and the doubles note instead of Record", () => {
    const others = [kristina, { name: "Theo Brandt", avatarUrl: null }, { name: "Mia Kowalski", avatarUrl: "/objects/uploads/m" }];
    const [m] = upcomingList({ open: [open({ format: "doubles", others })], now });
    expect(m.opponentName).toBeNull();
    expect(openLead(m)).toEqual({
      line: "Doubles · You, Kristina, Theo and Mia",
      spoken: "Doubles, You, Kristina, Theo and Mia",
      faces: [
        { name: "Kristina Novak", photo: "/objects/uploads/k" },
        { name: "Theo Brandt", photo: null },
        { name: "Mia Kowalski", photo: "/objects/uploads/m" },
      ],
    });
    expect(upcomingActions(m, { matchTimeAllowed: false, now })).toMatchObject({ record: false, doublesNote: true });
  });

  it("not full yet: it still leads, with the spots left and no Record", () => {
    const [m] = upcomingList({ open: [open({ status: "open", spotsLeft: 1, matchId: null, others: [] })], now });
    expect(openLead(m)).toMatchObject({ line: "Singles · 1 spot left", faces: [] });
    expect(m.matchId).toBeNull();
    expect(upcomingActions(m, { matchTimeAllowed: false, now })).toMatchObject({ record: false, enterScore: false, doublesNote: false });
  });

  it("older servers without players or a match id still give a row", () => {
    const [m] = upcomingList({ open: [{ id: 3, startsAt: local(14, 18), format: "singles", courtName: null, status: "full", spotsLeft: 0 }], now });
    expect(m).toMatchObject({ opponentName: null, matchId: null, openPlayers: [] });
    expect(rowSub(m)).toBe("Open match · Singles · Full");
  });
});

describe("Ball Boi tab: Record only on match day (finding 64)", () => {
  const rec = (o: { scheduledAt?: string | null; playBy?: string | null; id?: number; timeZone?: string | null }) => ({
    id: 1,
    scheduledAt: null,
    location: null,
    leagueId: 4,
    leagueName: "Tuesday Flex",
    format: "singles" as const,
    opponentName: "Elena Ortiz",
    partnerName: null,
    ...o,
  });

  it("a set time today, past due included, is match day; later in the week isn't", () => {
    expect(isRecordDay(rec({ scheduledAt: local(14, 18) }), now)).toBe(true);
    expect(isRecordDay(rec({ scheduledAt: local(14, 7) }), now)).toBe(true);
    expect(isRecordDay(rec({ scheduledAt: local(19, 18) }), now)).toBe(false);
  });

  it("with no time set, match day is the play-by day", () => {
    expect(isRecordDay(rec({ playBy: ymd(19) }), now)).toBe(false);
    expect(isRecordDay(rec({ playBy: ymd(14) }), now)).toBe(true);
    expect(isRecordDay(rec({}), now)).toBe(false);
  });

  it("splits into today's full cards and Coming up rows, keeping the order", () => {
    const list = [rec({ id: 1, scheduledAt: local(14, 18) }), rec({ id: 2, scheduledAt: local(19, 18) }), rec({ id: 3, scheduledAt: local(22, 10) }), rec({ id: 4, playBy: ymd(19) })];
    const { today, later } = splitRecordDay(list, now);
    expect(today.map((m) => m.id)).toEqual([1]);
    expect(later.map((m) => m.id)).toEqual([2, 3, 4]);
    expect(splitRecordDay([], now)).toEqual({ today: [], later: [] });
  });

  it("a Coming up row reads like Home's: date and time over who and where from", () => {
    const row = upcomingFromRecordable(rec({ id: 9, scheduledAt: local(19, 18) }), "Tuesday Flex");
    expect(row).toMatchObject({ kind: "league", matchId: 9 });
    expect(rowWhen(row, now)).toBe("Thu, Nov 19 · 6 PM");
    expect(rowSub(row)).toBe("vs. Elena Ortiz · Tuesday Flex");
    const untimed = upcomingFromRecordable(rec({ id: 10, playBy: ymd(19) }), "Tuesday Flex");
    expect(rowWhen(untimed, now)).toBe("Play by Thu, Nov 19");
  });
});

describe("one name per thing (finding 64)", () => {
  it("an open match reads Open match on the Ball Boi tab, as on Home; only a Quick match reads Quick match", () => {
    expect(matchSourceLabel({ leagueName: null, source: "open" })).toBe("Open match");
    expect(matchSourceLabel({ leagueName: null, source: "quick" })).toBe("Quick match");
    expect(matchSourceLabel({ leagueName: null, source: "discover" })).toBe("Discover");
    expect(matchSourceLabel({ leagueName: "Tuesday Flex", source: "league" })).toBe("Tuesday Flex");
    // Older servers send no source.
    expect(matchSourceLabel({ leagueName: null })).toBe("Quick match");
  });
});
