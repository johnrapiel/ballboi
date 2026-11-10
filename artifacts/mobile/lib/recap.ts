import type { MatchRecap } from "@workspace/api-client-react";

import { winnerScoreLine } from "./winnerMark";

// The match recap (spec decision 148, John, Nov 8): a shareable image made
// after a score is entered, sized for Instagram Stories (9:16) and texts.
// You in full, your opponent as first name and last initial ("John Rapiel
// def. Sam P."; "Sam P. def. John Rapiel" when you lose), the score from the
// winner's side with the winner underlined, the date, the court and the
// league (or "Discover" / "Quick match"), your new season record ("5-2 this
// season") and the Ball Boi roundel. Doubles use team names in the same
// pattern, every name short: "John R. & Sam L. def. Jo P. & Lee K." (D7).
// Always the Day look. Pure, so the words are tested in
// lib/__tests__/recap.test.ts.
//
// Aces and winners join once those stats pass their accuracy bars (G1).

/** The image's size in points: 9:16, saved at 3x (1080 x 1920) for Instagram Stories. */
export const RECAP_SIZE = { width: 360, height: 640, scale: 3 } as const;

/** "Sam Patel" to "Sam P."; one name stays as it is; "Mary Jane Watson" to "Mary W.". */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? full.trim();
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last[0].toUpperCase()}.`;
}

export interface RecapView {
  /** The winner's side first, or yours first when there's no winner. */
  top: { names: string; won: boolean };
  joiner: "def." | "vs.";
  bottom: { names: string; won: boolean };
  /** "John Rapiel def. Sam P." */
  headline: string;
  /** From the winner's side: "7-6(4), 6-3", "6-3, 2-1 · RET", "W/O". */
  score: string;
  /** "Sat, Nov 7, 2026", or null with no date. */
  date: string | null;
  /** "Beacon Courts · Tuesday Flex 3.5", or just the league. */
  meta: string;
  /** "5-2 this season", or null. */
  season: string | null;
  /** What the image shows, for VoiceOver. */
  description: string;
}

export function recapView(r: Pick<MatchRecap, "you" | "side1" | "side2" | "score" | "winner" | "playedAt" | "court" | "context" | "season">): RecapView {
  const mine = r.you === 1 ? r.side1 : r.side2;
  const theirs = r.you === 1 ? r.side2 : r.side1;
  // Doubles (D7, John, Nov 9): both teams in short names, "John R. & Sam L. def. Jo P. & Lee K.".
  const me = mine.length > 1 ? mine.map(shortName).join(" & ") : mine.join(" & ");
  const them = theirs.map(shortName).join(" & ");
  const youWon = r.winner != null && r.winner === r.you;
  const theyWon = r.winner != null && r.winner !== r.you;
  const top = theyWon ? { names: them, won: true } : { names: me, won: youWon };
  const bottom = theyWon ? { names: me, won: false } : { names: them, won: false };
  const joiner = r.winner == null ? "vs." : "def.";
  // No winner (rare): the score from your side.
  const score = r.winner != null ? winnerScoreLine(r.score, r.winner === 1) : winnerScoreLine(r.score, r.you === 1);
  const d = r.playedAt ? new Date(r.playedAt) : null;
  const date = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : null;
  const meta = [r.court, r.context].filter(Boolean).join(" · ");
  const season = r.season ? `${r.season.wins}-${r.season.losses} this season` : null;
  const headline = `${top.names} ${joiner} ${bottom.names}`;
  const spokenHead = `${top.names} ${joiner === "def." ? "defeated" : "versus"} ${bottom.names}`;
  const description = ["Ball Boi match recap", `${spokenHead}, ${score}`, date, meta, season].filter(Boolean).join(". ") + ".";
  return { top, joiner, bottom, headline, score, date, meta, season, description };
}
