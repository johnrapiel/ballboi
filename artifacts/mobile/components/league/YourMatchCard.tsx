import { router } from "expo-router";
import React from "react";
import { Alert, Pressable, View } from "react-native";

import { useOpenDoublesMatchChat } from "@workspace/api-client-react";

import { Icon } from "@/components/Icon";
import { MatchActions } from "@/components/MatchActions";
import { MatchTimeLink } from "@/components/MatchTimeLink";
import { RatingBadge } from "@/components/RatingBadge";
import { DoublesRecordButton } from "@/components/record/DoublesMatchCard";
import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { andJoin, isDoublesMatch, opponentNames, partnerName, versusLine, versusSpoken } from "@/lib/doubles";
import {
  canEnterScore,
  correctionLine,
  dateRange,
  deadlineDate,
  editedLine,
  LATE_NOTE,
  lateTime,
  matchWhen,
  opponentName,
  playByLine,
  recordAction,
  resultLine,
  shortDate,
  type MyWeek,
} from "@/lib/leagueSchedule";
import { MATCH_CARD_HINT } from "@/lib/matchActions";
import { isPastDue, pastDueWhen } from "@/lib/matchTiming";
import { levelSpoken } from "@/lib/onboarding";
import { openRecorder } from "@/lib/recording/start";

// Your match, at the top of the league page's Matches tab (decision 199, kept
// as it was when it sat on the one-card page, decision 185). The upcoming
// match, or this round's result once it's scored, until the next round goes
// out. Doubles shows your partner for the round: "You and Sam vs. Jo and Lee"
// (D8; this round's partner in rotating-partner leagues, L6). A bye has its
// own small card (ByeCard in LeagueMatchesTab).

export function YourMatchCard({
  leagueId,
  week,
  myPlayerId,
  timeZone,
  canSetTime,
  ended,
  doubles,
}: {
  leagueId: number;
  week: MyWeek;
  myPlayerId: number;
  timeZone: string | null;
  canSetTime: boolean;
  ended: boolean;
  /** A doubles league's match: Record shows dimmed with the reason. */
  doubles: boolean;
}) {
  // C6: hooks before any early return, so the card's hook order never changes.
  const c = useColors();
  const openChat = useOpenDoublesMatchChat();
  const { round, match } = week;
  const label = `Round ${round.roundNumber} · ${dateRange(round.startDate, round.deadline)}`;

  if (!match) return null;

  // Doubles (D6, D8): "You and Sam vs. Jo and Lee", and Message opens one chat for all four.
  const isDoubles = isDoublesMatch(match);
  const partner = isDoubles ? partnerName(match, myPlayerId) : null;
  const others = isDoubles ? opponentNames(match, myPlayerId) : [];
  const opponent = opponentName(match, myPlayerId);
  const opponentId = match.player1Id === myPlayerId ? match.player2Id : match.player1Id;
  const opponentRating = isDoubles ? null : match.player1Id === myPlayerId ? match.player2Rating : match.player1Rating;
  const canMessage = isDoubles || (match.player1Id === myPlayerId ? match.player2HasAccount : match.player1HasAccount);
  const scoreable = canEnterScore(round, match, ended);
  const recordable = recordAction(round, match, ended, doubles);
  // Finding 47: an hour past the set start with no score, Enter score leads and
  // Record with Ball Boi is a text link (in case they're still playing). Doubles
  // has nothing to record yet, so its dimmed Record steps away.
  const pastDue = scoreable && isPastDue({ scheduledAt: match.scheduledAt, score: match.score, timeZone });
  const record = pastDue ? null : recordable;
  // C7: a direct chat with your opponent.
  const message = () => {
    if (!isDoubles) {
      router.push({ pathname: "/conversation/[id]", params: { id: "new", playerId: String(opponentId), name: opponent } });
      return;
    }
    openChat
      .mutateAsync({ leagueId, matchId: match.matchId })
      .then(({ groupId }) => router.push({ pathname: "/conversation/group/[id]", params: { id: String(groupId) } }))
      .catch((e) => Alert.alert("Couldn't open the chat", (e as { data?: { error?: string } | null }).data?.error ?? "Try again in a moment."));
  };
  const played = match.status === "completed" && !!match.score;
  const corrected = correctionLine(match) ?? editedLine(match);
  // Older matches only: before the 24-hour edit, an undo left who cleared it.
  const clearedNote = !played && match.scoreClearedBy ? `Score cleared by ${match.scoreClearedBy}. ` : "";
  const when = played
    ? [resultLine(match, round, ended), corrected].filter(Boolean).join(". ")
    : clearedNote +
      (round.phase === "upcoming"
      ? `Starts ${shortDate(round.startDate)}. Play by ${deadlineDate(round.deadline, timeZone)}.`
      : round.phase === "grace"
        ? `${playByLine(round.graceEnd, timeZone)}. ${LATE_NOTE}`
        : `Play by ${deadlineDate(round.deadline, timeZone)}.`);
  // A late match keeps its saved time only while that's still ahead (decision 152).
  const matchTime = matchWhen(round.phase === "grace" ? lateTime(match.scheduledAt) : match.scheduledAt);
  // Wave 2 finding 25 (John, Nov 12): the time sits under the date line, and
  // "Set a match time" or "Change time" is link text right below it, as on
  // Match detail. No Match time row under the buttons.
  const timeOpen = !played && !match.voided && round.phase !== "closed" && !ended;
  // Past due, the time reads "Earlier today · 6:30 PM" (finding 47).
  const shownTime = timeOpen ? (pastDue && match.scheduledAt ? pastDueWhen(match.scheduledAt) : matchTime) : null;
  const canSetThisTime = timeOpen && canSetTime && scoreable;

  // Tapping the card opens Match detail (finding 54, decision 199); the
  // buttons inside stay their own VoiceOver elements and taps.
  const openMatch = () => router.push(`/match/${match.matchId}`);

  return (
    <Pressable
      accessible={false}
      onPress={openMatch}
      style={({ pressed }) => ({
        backgroundColor: c.linen,
        borderColor: c.hairline,
        borderWidth: 1,
        borderRadius: radius.radiusCard,
        padding: spacing.space4,
        gap: spacing.space3,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityHint={MATCH_CARD_HINT}
        onAccessibilityTap={openMatch}
        accessibilityLabel={`Your match. ${label}. ${isDoubles ? versusSpoken(partner, others) : `You versus ${opponent}`}${
          opponentRating ? `, ${levelSpoken(opponentRating.rating, opponentRating.source)}` : ""
        }. ${when}${shownTime ? ` Match time, ${shownTime}.` : ""}`.replace(/ & /g, " and ")}
        style={{ gap: spacing.space1 }}
      >
        <Text variant="section" tone="inkMuted">
          {label}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space2 }}>
          <Text variant="title">{isDoubles ? versusLine(partner, others) : `You vs. ${opponent}`}</Text>
          {opponentRating ? <RatingBadge rating={opponentRating.rating} source={opponentRating.source} /> : null}
        </View>
        <Text variant="small" tone="inkMuted">
          {when}
        </Text>
        {shownTime ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
            <Icon name="calendar" size={16} tintColor={c.inkMuted} />
            <Text variant="small" tone="inkMuted" style={{ flexShrink: 1 }}>
              {shownTime}
            </Text>
          </View>
        ) : null}
      </View>
      {canSetThisTime ? (
        <MatchTimeLink
          align="left"
          hasTime={!!matchTime}
          opponent={isDoubles ? andJoin(others) : opponent}
          onPress={() => router.push(`/league/${leagueId}/time/${match.matchId}`)}
          // Sits right under the date line; its 44pt target is hitSlop (decision 192).
        />
      ) : null}
      {/* The same actions as Home and Match detail (finding 54, decision 199):
          Record with Ball Boi (any day of the match's week, John, Nov 8,
          option A), then Message and Enter score. Doubles shows Record
          dimmed with the reason as visible text. Past due (finding 47),
          Enter score leads and Record is a link. The visible word is just
          "Message" so the pair fits; VoiceOver still names who. */}
      <MatchActions
        pastDue={pastDue}
        record={
          recordable === "record"
            ? {
                label: "Record with Ball Boi",
                hint: `Records your match against ${opponent}`,
                onPress: () => openRecorder(router, { matchId: match.matchId, opponentName: opponent, leagueId }),
              }
            : null
        }
        recordPlaceholder={record === "doubles" ? <DoublesRecordButton matchId={match.matchId} /> : null}
        message={
          canMessage
            ? {
                label: "Message",
                accessibilityLabel: isDoubles ? "Message all four players" : `Message ${opponent}`,
                hint: isDoubles ? "Opens one group chat for the four of you" : "Opens a direct chat",
                loading: openChat.isPending,
                onPress: message,
              }
            : null
        }
        enterScore={
          scoreable
            ? {
                label: "Enter score",
                hint: `For your match against ${opponent}`,
                onPress: () => router.push(`/league/${leagueId}/score/${match.matchId}`),
              }
            : null
        }
      />
    </Pressable>
  );
}
