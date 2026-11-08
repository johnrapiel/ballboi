import type { Career, CareerWonLost } from "@workspace/api-client-react";

// Career (spec decision 147, John, Nov 8): your full history, opened from See
// all on Profile's This season. Pure, so the labels are tested in
// lib/__tests__/career.test.ts.
//
// Ball Boi career stats (aces, winners) join once they pass their accuracy
// bars (G1): add them as their own cells here, beside careerCells, when the
// API starts sending them. Nothing about them shows until then.

/** "58%", or a dash before anything was played. */
export function shareLabel(wl: CareerWonLost): string {
  const total = wl.won + wl.lost;
  return total ? `${Math.round((wl.won / total) * 100)}%` : "–";
}

/** "58 percent of sets won, 21 of 36", for VoiceOver. */
export function shareSpoken(wl: CareerWonLost, what: string): string {
  const total = wl.won + wl.lost;
  if (!total) return `no ${what} yet`;
  return `${Math.round((wl.won / total) * 100)} percent of ${what} won, ${wl.won} of ${total}`;
}

/** The six cells on Career: Record, Played, Best streak, then Sets won, Games won, Tiebreaks. */
export function careerCells(c: Pick<Career, "wins" | "losses" | "played" | "bestWinStreak" | "sets" | "games" | "tiebreaks">): { label: string; value: string }[] {
  return [
    { label: "Record", value: `${c.wins}–${c.losses}` },
    { label: "Played", value: String(c.played) },
    { label: "Best streak", value: c.bestWinStreak ? `W${c.bestWinStreak}` : "–" },
    { label: "Sets won", value: shareLabel(c.sets) },
    { label: "Games won", value: shareLabel(c.games) },
    { label: "Tiebreaks", value: `${c.tiebreaks.won}–${c.tiebreaks.lost}` },
  ];
}

/** Career in words, read as one group. */
export function careerSpoken(c: Pick<Career, "wins" | "losses" | "played" | "bestWinStreak" | "sets" | "games" | "tiebreaks">): string {
  const streak = c.bestWinStreak ? `best win streak ${c.bestWinStreak}` : "no wins yet";
  const tb = c.tiebreaks.won + c.tiebreaks.lost ? `tiebreaks ${c.tiebreaks.won} won, ${c.tiebreaks.lost} lost` : "no tiebreaks yet";
  return `Career: record ${c.wins} and ${c.losses}, played ${c.played}, ${streak}, ${shareSpoken(c.sets, "sets")}, ${shareSpoken(c.games, "games")}, ${tb}`;
}

/** A head-to-head row: "Sam Patel · 2-1", read "Sam Patel. You won 2, lost 1." */
export function headToHeadRow(h: Career["headToHead"][number]): { text: string; spoken: string } {
  return {
    text: `${h.name} · ${h.wins}-${h.losses}`,
    spoken: `${h.name}. You won ${h.wins}, lost ${h.losses}.`,
  };
}

/** A season's record: "5-2", read "5 wins, 2 losses". */
export function seasonRecord(s: Pick<Career["seasons"][number], "wins" | "losses">): { text: string; spoken: string } {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return { text: `${s.wins}-${s.losses}`, spoken: `${plural(s.wins, "win", "wins")}, ${plural(s.losses, "loss", "losses")}` };
}

/** One season's results, newest first, for the season screen. */
export function seasonResults(c: Pick<Career, "results">, key: string): Career["results"] {
  return c.results.filter((r) => r.seasonKey === key);
}

/** A career result as Profile's Results row reads it. */
export function careerResultRow(r: Career["results"][number]): { won: boolean; score: string; opponentName: string; leagueName: string; playoff: boolean; inGrace: boolean } {
  return { won: r.won, score: r.score, opponentName: r.opponentName, leagueName: r.context, playoff: r.playoff, inGrace: false };
}
