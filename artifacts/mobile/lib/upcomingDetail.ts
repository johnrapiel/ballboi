import type { MatchDetail } from "@workspace/api-client-react";

import { deadlineDate, lateTime } from "./leagueSchedule";
import { cardLead } from "./matchTiming";
import { isMatchDay, type UpcomingItem } from "./upcoming";

// Match detail for a match not played yet (Wave 2 finding 9, John, Nov 11):
// the same card as Home's next match, with its actions. Pure, so it's tested
// in lib/__tests__.

const validIso = (iso: string | null | undefined): iso is string => !!iso && !Number.isNaN(new Date(iso).getTime());

/**
 * The match as an upcoming item, for the D2 card. Home's own item is used
 * when the match is in your upcoming list (it knows the Play by date); this
 * fills in from Match detail otherwise. `context` is the pill text.
 */
export function upcomingFromDetail(
  d: Pick<MatchDetail, "matchId" | "source" | "leagueId" | "singles" | "timeZone" | "playoffRound" | "scheduledAt" | "location" | "lateUntil" | "you" | "opponents">,
  context: string,
  now: Date = new Date(),
): UpcomingItem {
  const late = !!d.lateUntil;
  const scheduledAt = late ? lateTime(d.scheduledAt, now) : validIso(d.scheduledAt) ? d.scheduledAt : null;
  const them = d.opponents.players;
  const partner = d.you.players.find((p) => !p.you) ?? null;
  const single = d.singles && them.length === 1 ? them[0] : null;
  const source = d.source ?? "league";
  return {
    key: `detail-${d.matchId}`,
    // A Quick match acts like a Discover one here: Record and Message, no league actions.
    kind: source === "league" ? (d.playoffRound ? "playoff" : "league") : "discover",
    scheduledAt,
    playBy: d.lateUntil ? deadlineDate(d.lateUntil, d.timeZone) : null,
    starts: null,
    opponentName: them.map((p) => p.name).join(" & ") || "your opponent",
    opponentPlayerId: single?.hasAccount ? single.playerId : null,
    partnerName: d.singles ? null : (partner?.name ?? null),
    opponentNames: d.singles ? [] : them.map((p) => p.name),
    opponentPhoto: single?.avatarUrl ?? null,
    otherUserId: null,
    leagueId: d.leagueId,
    context,
    matchId: d.matchId,
    location: d.location,
    singles: d.singles,
    grace: late,
    notStarted: false,
    openMatchId: null,
    openStatus: null,
    sortAt: scheduledAt ?? "",
    timeZone: d.timeZone ?? null,
  };
}

export interface UpcomingActions {
  /** Record with Ball Boi, singles only. */
  record: boolean;
  /**
   * An hour past the start with no score (finding 47): Enter score leads and
   * Record with Ball Boi is a text link under it.
   */
  pastDue: boolean;
  /** Doubles: the note on why Ball Boi can't record it yet. */
  doublesNote: boolean;
  /** League and playoff matches: the league's Enter score. */
  enterScore: boolean;
  /** League weekly matches in a league with no fixed weekly time. */
  matchTime: boolean;
}

/**
 * Which actions an unplayed match offers on Match detail. League and playoff
 * matches follow the league page: Record any day the match can be played,
 * then Enter score, and Match time where the league lets players set it.
 * A Discover or Quick match follows Home: Record on match day; its score is
 * entered from its chat card or the recording, and from the card once it's
 * past due. An open match follows Discover once it's full (finding 63). Past due, Enter score leads and Record is a link; doubles has no
 * Record to link to, so its note steps away too.
 */
export function upcomingActions(
  m: Pick<UpcomingItem, "kind" | "matchId" | "notStarted" | "singles" | "scheduledAt"> & { timeZone?: string | null },
  opts: { matchTimeAllowed: boolean; now?: Date },
): UpcomingActions {
  const playable = m.matchId != null && !m.notStarted;
  if (m.kind === "league" || m.kind === "playoff") {
    const lead = cardLead(m, { canRecord: playable && m.singles, now: opts.now });
    const pastDue = playable && lead.pastDue;
    return {
      record: lead.record != null,
      pastDue,
      doublesNote: playable && !m.singles && !pastDue,
      enterScore: playable,
      matchTime: m.kind === "league" && playable && opts.matchTimeAllowed,
    };
  }
  const today = playable && isMatchDay(m, opts.now);
  const lead = cardLead(m, { canRecord: today && m.singles, now: opts.now });
  const pastDue = playable && lead.pastDue;
  // A full doubles open match on its day shows the same note as a doubles league match (finding 63).
  const doublesNote = m.kind === "open" && today && !m.singles && !pastDue;
  return { record: lead.record != null, pastDue, doublesNote, enterScore: pastDue, matchTime: false };
}
