import type { PlayerCard, PlayerCardSeason, PlayerMatches } from "@workspace/api-client-react";

import { deadlineDate } from "./leagueSchedule";
import { milestonesSpoken } from "./milestones";
import type { UpcomingItem } from "./upcoming";


// The player card, design D (spec decisions 138 to 140, John, Nov 8): the
// same card on Profile and in Discover. Pure, so it's tested in lib/__tests__.

/** "3.5", as levels read everywhere (lib/onboarding's formatRating, which can't load in Node tests). */
const formatRating = (n: number) => n.toFixed(1);

/** "Level 3.5", never "Self-rated" on the card (decision 140). */
export function levelPill(rating: number | null | undefined): string | null {
  return rating == null ? null : `Level ${formatRating(rating)}`;
}

/** Edit profile's Level row keeps "Self-rated" (decision 140): "3.5 · Self-rated", or "3.5 · Verified". */
export function levelRow(rating: number | null | undefined, source: string | null | undefined): string {
  if (rating == null) return "Not set";
  return `${formatRating(rating)} · ${source === "verified" ? "Verified" : "Self-rated"}`;
}

/** The Plays pill: "Singles", "Doubles" or "Singles and doubles". */
export function playsPill(plays: PlayerCard["plays"]): string | null {
  return plays === "singles" ? "Singles" : plays === "doubles" ? "Doubles" : plays === "both" ? "Singles and doubles" : null;
}

/**
 * Prompts in place (John, Nov 9): on your own card only, a light link where
 * an unset home court or Plays pill would sit. Someone else's card never
 * prompts; those spots are simply left out.
 */
export function cardPrompts(card: Pick<PlayerCard, "you" | "homeCourt" | "plays">): { homeCourt: boolean; plays: boolean } {
  return {
    homeCourt: card.you && !card.homeCourt,
    plays: card.you && playsPill(card.plays) == null,
  };
}

export const ADD_HOME_COURT = "Add home court";
export const ADD_PLAYS = "Add how you play";

/**
 * The card's bottom row. "split": something on the left (the court or your
 * Add home court link) and Free times on the right. "start": one item alone,
 * left-aligned so it reads as a footer, not a gap (someone else's card with
 * no home court). null: no row at all.
 */
export function bottomRow(card: Pick<PlayerCard, "you" | "homeCourt" | "plays" | "freeTimes">): {
  left: "court" | "prompt" | null;
  free: boolean;
  align: "split" | "start";
} | null {
  const left = card.homeCourt ? "court" : cardPrompts(card).homeCourt ? "prompt" : null;
  const free = card.you || card.freeTimes.length > 0;
  if (!left && !free) return null;
  return { left, free, align: left && free ? "split" : "start" };
}

/** The town, with the distance on someone else's card: "Fishkill · ~4 mi away". */
export function townLine(card: Pick<PlayerCard, "town" | "distance">): string | null {
  const parts = [card.town, card.distance].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The card as one VoiceOver element: "Your player card. John Rapiel, level
 * 3.5, singles, Wappingers Falls, milestones: first win, 5-match win streak.
 * Home court Beacon Courts." Milestones (decision 150) only when earned.
 */
export function cardSpoken(card: Pick<PlayerCard, "name" | "rating" | "plays" | "town" | "distance" | "homeCourt" | "you"> & { milestones?: PlayerCard["milestones"] }): string {
  const about = [
    card.name,
    card.rating != null ? `level ${formatRating(card.rating)}` : null,
    playsPill(card.plays)?.toLowerCase() ?? null,
    card.town,
    card.distance ? card.distance.replace("~", "about ").replace(" mi ", " miles ") : null,
    milestonesSpoken(card.milestones),
  ]
    .filter(Boolean)
    .join(", ");
  const head = card.you ? "Your player card" : "Player card";
  return `${head}. ${about}.${card.homeCourt ? ` Home court ${card.homeCourt}.` : ""}`;
}

/** This season's four cells: Record, Played, Streak, No-shows (canvas W2_ProfileCard). */
export function seasonCells(s: PlayerCardSeason): { label: string; value: string }[] {
  return [
    { label: "Record", value: `${s.wins}–${s.losses}` },
    { label: "Played", value: String(s.played) },
    { label: "Streak", value: s.streak ? `${s.streak.won ? "W" : "L"}${s.streak.count}` : "–" },
    { label: "No-shows", value: String(s.noShows) },
  ];
}

/** This season in words, read as one group: "This season: record 4 and 2, played 6, won the last 2, no no-shows". */
export function seasonSpoken(s: PlayerCardSeason): string {
  const streak = s.streak ? `${s.streak.won ? "won" : "lost"} the last ${s.streak.count === 1 ? "match" : s.streak.count}` : "no streak yet";
  const noShows = s.noShows === 0 ? "no no-shows" : `${s.noShows} no-show${s.noShows === 1 ? "" : "s"}`;
  return `This season: record ${s.wins} and ${s.losses}, played ${s.played}, ${streak}, ${noShows}`;
}

/** Recordings made this season (YYYY-MM-DD window, the phone's day). */
export function recordedThisSeason<T extends { recordedAt: string }>(recordings: readonly T[], season: Pick<PlayerCardSeason, "from" | "to">): T[] {
  return recordings.filter((r) => {
    const d = new Date(r.recordedAt);
    if (Number.isNaN(d.getTime())) return false;
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return day >= season.from && day <= season.to;
  });
}

/** "3 matches recorded", for Ball Boi this season until a stat passes its bar (G1). */
export function recordedLine(n: number): string {
  return `${n} ${n === 1 ? "match" : "matches"} recorded`;
}

export type MatchTab = "upcoming" | "results";

/** The tab a link asks for: /profile?tab=results, or Upcoming matches by default. */
export function tabFromParam(tab: unknown): MatchTab | null {
  if (tab === "results") return "results";
  if (tab === "upcoming") return "upcoming";
  return null;
}

export const TAB_LABELS: Record<MatchTab, string> = { upcoming: "Upcoming matches", results: "Results" };

/** Head-to-head above their tabs: "You and Priya: 2-1", from your side. */
export function headToHeadLine(name: string, h: { you: number; them: number }): { text: string; spoken: string } {
  const first = name.split(" ")[0] || name;
  const total = h.you + h.them;
  return {
    text: `You and ${first}: ${h.you}-${h.them}`,
    spoken: `You and ${first} have played ${total} ${total === 1 ? "time" : "times"}. You won ${h.you}, ${first} won ${h.them}.`,
  };
}

/** Their upcoming match as the same row your own list shows. */
export function otherUpcomingItem(u: PlayerMatches["upcoming"][number]): UpcomingItem {
  return {
    key: u.key,
    kind: u.kind,
    scheduledAt: u.scheduledAt,
    playBy: u.playBy ? deadlineDate(u.playBy, null) : null,
    starts: null,
    opponentName: u.opponentName,
    opponentPlayerId: null,
    // Rows show no faces.
    opponentPhoto: null,
    otherUserId: u.opponentUserId,
    leagueId: null,
    context: u.context,
    matchId: u.matchId,
    location: u.location,
    singles: true,
    grace: false,
    notStarted: false,
    openMatchId: null,
    openStatus: null,
    sortAt: u.scheduledAt ?? u.playBy ?? "",
  };
}

/** "Tuesday Flex 3.5 · Nov 3" under a result's names. */
export function resultMeta(r: Pick<PlayerMatches["results"][number], "context" | "completedAt">): string {
  const d = r.completedAt ? new Date(r.completedAt) : null;
  const day = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  return [r.context, day].filter(Boolean).join(" · ");
}
