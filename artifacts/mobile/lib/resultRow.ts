import type { Career, PlayerMatches } from "@workspace/api-client-react";

import { versusLine, versusSpoken } from "@/lib/doubles";
import { LATE_RESULT } from "@/lib/leagueSchedule";
import { isDoubleDefault, WALKOVER_SCORE } from "@/lib/tennisScore";

// A result on Profile's Results and Career's seasons (John, Nov 10): every
// match you played, league, Discover and Quick match, newest first. W or L
// with the letter, never color alone, then the score from your side, who it
// was against and where it came from. W/O and Double default show as those
// words. Pure, so the words are tested in lib/__tests__/resultRow.test.ts.

/** What a row needs. `won` is null when there's no winner: a double default. */
export interface ResultRowData {
  matchId: number;
  won: boolean | null;
  /** From your side. W/O, RET and Double default stay as they are. */
  score: string;
  /** The other side: "Sam Lee", or "Jo Park & Lee Kim" in doubles. */
  opponentName: string;
  partnerName?: string | null;
  /** League name, "League" for a private league you're not in, "Discover" or "Quick match". */
  leagueName: string;
  playoff: boolean;
  inGrace: boolean;
}

/** Your own Results from GET /player-cards/me/matches, newest first. */
export function myResultRows(results: PlayerMatches["results"]): ResultRowData[] {
  return results.flatMap((r) =>
    r.yours
      ? [
          {
            matchId: r.matchId,
            won: r.yours.won,
            score: r.yours.score,
            opponentName: r.yours.opponentName,
            partnerName: r.yours.partnerName,
            leagueName: r.context,
            playoff: r.playoff,
            inGrace: r.inGrace,
          },
        ]
      : [],
  );
}

/** A career result as the same row reads it. */
export function careerResultRow(r: Career["results"][number]): ResultRowData {
  return {
    matchId: r.matchId,
    won: r.won,
    score: r.score,
    opponentName: r.opponentName,
    partnerName: r.partnerName,
    leagueName: r.context,
    playoff: r.playoff,
    inGrace: false,
  };
}

/** The second line and what VoiceOver reads for the whole row. */
export function resultRowText(r: ResultRowData): { sub: string; label: string } {
  const others = r.opponentName.split(" & ");
  const who = r.partnerName ? versusLine(r.partnerName, others) : `vs. ${r.opponentName}`;
  const spokenWho = r.partnerName ? versusSpoken(r.partnerName, others) : `versus ${r.opponentName}`;
  const tail = [r.leagueName, r.playoff ? "Playoffs" : null, r.inGrace ? LATE_RESULT : null].filter(Boolean) as string[];
  const sub = [who, ...tail].join(" · ");
  return { sub, label: `${outcomeSpoken(r)}. ${[spokenWho, ...tail].join(", ")}` };
}

/** "Won 6-3, 6-4", "Lost by walkover", "Double default, no winner". */
export function outcomeSpoken(r: Pick<ResultRowData, "won" | "score">): string {
  if (isDoubleDefault(r.score)) return "Double default, no winner";
  const verb = r.won == null ? null : r.won ? "Won" : "Lost";
  if (r.score.trim() === WALKOVER_SCORE) return verb ? `${verb} by walkover` : "Walkover";
  return verb ? `${verb} ${r.score}` : r.score;
}
