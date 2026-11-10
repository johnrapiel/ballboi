import { describe, it, expect } from "vitest";
import {
  autoTeams,
  checkNewTeam,
  bestSplit,
  doublesHistory,
  pairFixedDoubles,
  pairRotatingDoubles,
  pickSitters,
  teamMeetings,
  type DoublesMatchup,
} from "../lib/doublesPairing.js";
import { FLEX_WEIGHTS, ROUND_ROBIN_WEIGHTS, pairKey, type PairingPlayer } from "../lib/pairing.js";

// Wave 2: doubles pairing for fixed-partner and rotating-partner leagues.

function p(id: number, rating = 3.5, extra: Partial<PairingPlayer> = {}): PairingPlayer {
  return { id, rating, slots: null, byes: 0, ...extra };
}

const empty = () => doublesHistory([]);

function everyoneOnce(matches: DoublesMatchup[], byes: number[], ids: number[]) {
  const placed = [...matches.flatMap((m) => [...m.team1, ...m.team2]), ...byes].sort((a, b) => a - b);
  expect(placed).toEqual([...ids].sort((a, b) => a - b));
}

describe("doublesHistory", () => {
  it("counts partners and opponents from player1+player3 against player2+player4", () => {
    const h = doublesHistory([{ player1Id: 1, player2Id: 2, player3Id: 3, player4Id: 4 }]);
    expect(h.partners.get(pairKey(1, 3))).toBe(1);
    expect(h.partners.get(pairKey(2, 4))).toBe(1);
    expect(h.opponents.get(pairKey(1, 2))).toBe(1);
    expect(h.opponents.get(pairKey(3, 4))).toBe(1);
    expect(h.opponents.get(pairKey(1, 3))).toBeUndefined();
  });

  it("reads singles rows as opponents only", () => {
    const h = doublesHistory([{ player1Id: 1, player2Id: 2, player3Id: null, player4Id: null }]);
    expect(h.opponents.get(pairKey(1, 2))).toBe(1);
    expect(h.partners.size).toBe(0);
  });
});

describe("pickSitters", () => {
  it("sits out the fewest byes first", () => {
    expect(pickSitters([p(1, 3.5, { byes: 1 }), p(2), p(3, 3.5, { byes: 1 })], 1, 1)).toEqual([2]);
  });

  it("rotates among players tied on byes", () => {
    const players = [p(1), p(2), p(3), p(4), p(5)];
    expect(pickSitters(players, 1, 1)).toEqual([1]);
    expect(pickSitters(players, 1, 2)).toEqual([2]);
  });
});

describe("bestSplit", () => {
  it("makes even teams: strongest with weakest", () => {
    const rating = (id: number) => ({ 1: 3.0, 2: 3.0, 3: 4.0, 4: 4.0 })[id]!;
    const m = bestSplit([1, 2, 3, 4], rating, empty(), FLEX_WEIGHTS);
    // Each team has one 3.0 and one 4.0.
    expect(m.team1.map(rating).sort()).toEqual([3, 4]);
    expect(m.team2.map(rating).sort()).toEqual([3, 4]);
  });

  it("avoids repeat partners", () => {
    const h = doublesHistory([{ player1Id: 1, player2Id: 2, player3Id: 3, player4Id: 4 }]);
    const m = bestSplit([1, 2, 3, 4], () => 3.5, h, FLEX_WEIGHTS);
    expect([pairKey(...m.team1), pairKey(...m.team2)]).not.toContain(pairKey(1, 3));
    expect([pairKey(...m.team1), pairKey(...m.team2)]).not.toContain(pairKey(2, 4));
  });
});

describe("pairRotatingDoubles", () => {
  it("puts everyone in one match or a bye", () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const { matches, byes } = pairRotatingDoubles({ players: ids.map((id) => p(id)), history: empty(), weights: FLEX_WEIGHTS, roundNumber: 1 });
    expect(matches).toHaveLength(2);
    expect(byes).toHaveLength(2);
    everyoneOnce(matches, byes, ids);
  });

  it("groups close levels together in Flex", () => {
    const players = [p(1, 2.5), p(2, 2.5), p(3, 2.5), p(4, 2.5), p(5, 4.5), p(6, 4.5), p(7, 4.5), p(8, 4.5)];
    const { matches } = pairRotatingDoubles({ players, history: empty(), weights: FLEX_WEIGHTS, roundNumber: 1 });
    for (const m of matches) {
      const four = [...m.team1, ...m.team2].sort((a, b) => a - b);
      expect([[1, 2, 3, 4], [5, 6, 7, 8]]).toContainEqual(four);
    }
  });

  it("gives new partners the next week", () => {
    const players = [p(1), p(2), p(3), p(4)];
    const first = pairRotatingDoubles({ players, history: empty(), weights: FLEX_WEIGHTS, roundNumber: 1 });
    const h = doublesHistory(
      first.matches.map((m) => ({ player1Id: m.team1[0], player3Id: m.team1[1], player2Id: m.team2[0], player4Id: m.team2[1] })),
    );
    const second = pairRotatingDoubles({ players, history: h, weights: FLEX_WEIGHTS, roundNumber: 2 });
    const before = first.matches.flatMap((m) => [pairKey(...m.team1), pairKey(...m.team2)]);
    const after = second.matches.flatMap((m) => [pairKey(...m.team1), pairKey(...m.team2)]);
    expect(after.some((k) => before.includes(k))).toBe(false);
  });

  it("sits out everyone with fewer than 4 players", () => {
    const { matches, byes } = pairRotatingDoubles({ players: [p(1), p(2), p(3)], history: empty(), weights: FLEX_WEIGHTS, roundNumber: 1 });
    expect(matches).toEqual([]);
    expect(byes.sort()).toEqual([1, 2, 3]);
  });

  it("never puts two players on court together when one blocked the other", () => {
    const blocked = new Set([pairKey(1, 2)]);
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    const { matches, byes } = pairRotatingDoubles({ players: ids.map((id) => p(id)), history: empty(), weights: ROUND_ROBIN_WEIGHTS, roundNumber: 1, blocked });
    everyoneOnce(matches, byes, ids);
    for (const m of matches) {
      const four = [...m.team1, ...m.team2];
      expect(four.includes(1) && four.includes(2)).toBe(false);
    }
    expect(matches).toHaveLength(2);
  });

  it("sits out the four when there's no way around a block", () => {
    const blocked = new Set([pairKey(1, 2)]);
    const { matches, byes } = pairRotatingDoubles({ players: [p(1), p(2), p(3), p(4)], history: empty(), weights: FLEX_WEIGHTS, roundNumber: 1, blocked });
    expect(matches).toEqual([]);
    expect(byes.sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("pairFixedDoubles", () => {
  const teams = [
    { id: 10, playerIds: [1, 2] as [number, number] },
    { id: 11, playerIds: [3, 4] as [number, number] },
    { id: 12, playerIds: [5, 6] as [number, number] },
  ];
  const players = [p(1, 3.0), p(2, 3.0), p(3, 3.5), p(4, 3.5), p(5, 4.5), p(6, 4.5)];

  it("keeps partners together and gives one team a bye with an odd count", () => {
    const { matches, byes } = pairFixedDoubles({ teams, players, teamHistory: new Map(), weights: FLEX_WEIGHTS, roundNumber: 1 });
    expect(matches).toHaveLength(1);
    expect(byes).toHaveLength(2);
    for (const m of matches) for (const t of [m.team1, m.team2]) expect(teams.map((x) => x.playerIds)).toContainEqual(t);
    everyoneOnce(matches, byes, [1, 2, 3, 4, 5, 6]);
  });

  it("pairs teams that haven't met", () => {
    const four = teams.slice(0, 2).concat([{ id: 13, playerIds: [7, 8] }]).concat([{ id: 12, playerIds: [5, 6] }]);
    const all = [...players, p(7, 3.0), p(8, 3.0)];
    const history = new Map([[pairKey(10, 11), 1]]);
    const { matches } = pairFixedDoubles({ teams: four, players: all, teamHistory: history, weights: ROUND_ROBIN_WEIGHTS, roundNumber: 2 });
    const met = matches.some(
      (m) => (m.team1[0] === 1 && m.team2[0] === 3) || (m.team1[0] === 3 && m.team2[0] === 1),
    );
    expect(met).toBe(false);
  });

  it("skips a team whose partner isn't playing this week", () => {
    const { matches, byes } = pairFixedDoubles({ teams, players: players.filter((x) => x.id !== 6), teamHistory: new Map(), weights: FLEX_WEIGHTS, roundNumber: 1 });
    expect(matches).toHaveLength(1);
    expect(byes).toEqual([]);
  });
});

describe("teamMeetings", () => {
  it("counts matches between two fixed teams on either side", () => {
    const teams = [
      { id: 10, playerIds: [1, 2] as [number, number] },
      { id: 11, playerIds: [3, 4] as [number, number] },
    ];
    const m = teamMeetings(teams, [
      { player1Id: 1, player3Id: 2, player2Id: 3, player4Id: 4 },
      { player1Id: 4, player3Id: 3, player2Id: 2, player4Id: 1 },
    ]);
    expect(m.get(pairKey(10, 11))).toBe(2);
  });
});

describe("autoTeams", () => {
  it("teams up the closest levels", () => {
    const { teams, left } = autoTeams([p(1, 3.0), p(2, 4.5), p(3, 3.0), p(4, 4.5)]);
    expect(left).toEqual([]);
    expect(teams).toContainEqual([1, 3]);
    expect(teams).toContainEqual([2, 4]);
  });

  it("leaves the newest player waiting with an odd number", () => {
    expect(autoTeams([p(1), p(2), p(3)]).left).toEqual([3]);
  });

  it("never teams two players where one blocked the other", () => {
    const { teams, left } = autoTeams([p(1), p(2)], new Set([pairKey(1, 2)]));
    expect(teams).toEqual([]);
    expect(left.sort()).toEqual([1, 2]);
  });
});

describe("checkNewTeam", () => {
  const teams = [{ id: 10, playerIds: [1, 2] as [number, number] }];
  const activePlayerIds = [1, 2, 3, 4];

  it("teams up two active players without partners", () => {
    expect(checkNewTeam({ teams, activePlayerIds, a: 3, b: 4 })).toBeNull();
  });

  it("refuses a player who already has a partner, the same player twice, or someone not in the league", () => {
    expect(checkNewTeam({ teams, activePlayerIds, a: 1, b: 3 })).toMatch(/already has a partner/);
    expect(checkNewTeam({ teams, activePlayerIds, a: 3, b: 3 })).toMatch(/two different/);
    expect(checkNewTeam({ teams, activePlayerIds, a: 3, b: 9 })).toMatch(/in this league/);
  });
});

describe("D5: rotating partners over a season", () => {
  function season(ids: number[], weeks: number, rating: (id: number) => number = () => 3.5, blocked = new Set<string>()) {
    const played: { player1Id: number; player2Id: number; player3Id: number; player4Id: number }[] = [];
    const byes = new Map<number, number>();
    const out: { matches: DoublesMatchup[]; byes: number[] }[] = [];
    for (let week = 1; week <= weeks; week++) {
      const r = pairRotatingDoubles({
        players: ids.map((id) => p(id, rating(id), { byes: byes.get(id) ?? 0 })),
        history: doublesHistory(played),
        weights: FLEX_WEIGHTS,
        roundNumber: week,
        blocked,
      });
      for (const m of r.matches) played.push({ player1Id: m.team1[0], player3Id: m.team1[1], player2Id: m.team2[0], player4Id: m.team2[1] });
      for (const b of r.byes) byes.set(b, (byes.get(b) ?? 0) + 1);
      out.push(r);
    }
    return { out, byes };
  }
  const partnersOf = (rounds: { matches: DoublesMatchup[] }[]) => rounds.flatMap((r) => r.matches.flatMap((m) => [pairKey(...m.team1), pairKey(...m.team2)]));

  it("4 players: three weeks, three different partners each, before anyone repeats", () => {
    const { out } = season([1, 2, 3, 4], 3);
    const keys = partnersOf(out);
    expect(new Set(keys).size).toBe(6);
  });

  it("8 players: no repeat partner in the first four weeks", () => {
    const { out } = season([1, 2, 3, 4, 5, 6, 7, 8], 4);
    const keys = partnersOf(out);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a repeat partner beats a level gap: new partners come first", () => {
    // 1-4 are 3.0 and 5-8 are 4.5; after 3 weeks the low four have all partnered.
    const rating = (id: number) => (id <= 4 ? 3.0 : 4.5);
    const { out } = season([1, 2, 3, 4, 5, 6, 7, 8], 4, rating);
    // Weeks 1 to 3 stay within level.
    for (const r of out.slice(0, 3)) {
      for (const m of r.matches) {
        const four = [...m.team1, ...m.team2];
        expect(four.every((id) => id <= 4) || four.every((id) => id > 4)).toBe(true);
      }
    }
    // Week 4 mixes levels rather than repeat a partner.
    const keys = partnersOf(out);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("splits each four into the most even teams", () => {
    const rating = (id: number) => ({ 1: 2.5, 2: 3.0, 3: 3.5, 4: 4.0 })[id]!;
    const { matches } = pairRotatingDoubles({ players: [1, 2, 3, 4].map((id) => p(id, rating(id))), history: empty(), weights: FLEX_WEIGHTS, roundNumber: 1 });
    const avg = (t: [number, number]) => (rating(t[0]) + rating(t[1])) / 2;
    expect(avg(matches[0].team1)).toBe(avg(matches[0].team2));
  });

  it("leftovers (1 to 3) get byes, fewest byes first, so byes even out", () => {
    const { out, byes } = season([1, 2, 3, 4, 5, 6], 6);
    for (const r of out) expect(r.byes).toHaveLength(2);
    expect([...byes.values()].every((n) => n === 2)).toBe(true);
    for (const n of [5, 7]) {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const { out: o } = season(ids, 1);
      expect(o[0].byes).toHaveLength(n % 4);
    }
  });

  it("blocked pairs never share a four, all season", () => {
    const blocked = new Set([pairKey(1, 2), pairKey(3, 7)]);
    const { out } = season([1, 2, 3, 4, 5, 6, 7, 8], 6, () => 3.5, blocked);
    for (const r of out) {
      for (const m of r.matches) {
        const four = [...m.team1, ...m.team2];
        for (const key of blocked) {
          const [a, b] = key.split("-").map(Number);
          expect(four.includes(a) && four.includes(b)).toBe(false);
        }
      }
    }
  });
});

describe("D2, D9: teaming up honors blocks", () => {
  it("refuses a blocked pair in words that don't say who blocked whom", () => {
    expect(checkNewTeam({ teams: [], activePlayerIds: [1, 2], a: 1, b: 2, blocked: new Set([pairKey(1, 2)]) })).toBe(
      "These two players can't be on a team together.",
    );
  });
});
