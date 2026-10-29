import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import type { ScheduleMatch, ScheduleRound, ScheduleWeek } from "@workspace/api-client-react";

import { Card, Chip, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { canEnterScore, dateRange, isMine, phaseLabel, resultLine, shortDate } from "@/lib/leagueSchedule";

// One week of a league season (spec: Leagues > Weekly loop). Every state is in
// words: "This week", "Grace week", "Cancelled", "Not played yet".

function MatchRow({
  m,
  round,
  myPlayerId,
  onEnterScore,
  last,
}: {
  m: ScheduleMatch;
  round: ScheduleRound;
  myPlayerId: number | null | undefined;
  onEnterScore: (m: ScheduleMatch) => void;
  last: boolean;
}) {
  const c = useColors();
  const mine = isMine(m, myPlayerId);
  const result = resultLine(m);
  const note = m.inGrace ? "Grace week: counts for ratings and stats, not standings" : null;
  const scoreable = mine && canEnterScore(round, m);
  const summary = `${m.player1Name} versus ${m.player2Name}. ${result}.${note ? ` ${note}.` : ""}`;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingVertical: spacing.space3,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
      }}
    >
      <View accessible accessibilityLabel={`${mine ? "Your match. " : ""}${summary}`} style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">
          {m.player1Name} vs. {m.player2Name}
        </Text>
        <Text variant="small" tone="inkMuted" style={m.voided ? { textDecorationLine: "line-through" } : undefined}>
          {result}
        </Text>
        {note ? (
          <Text variant="small" tone="inkMuted">
            {note}
          </Text>
        ) : null}
      </View>
      {scoreable ? (
        <Pressable
          onPress={() => onEnterScore(m)}
          accessibilityRole="button"
          accessibilityLabel="Enter score"
          accessibilityHint={`For your match against ${m.player1Id === myPlayerId ? m.player2Name : m.player1Name}`}
          style={({ pressed }) => ({
            minHeight: MIN_TAP,
            minWidth: MIN_TAP,
            justifyContent: "center",
            alignItems: "flex-end",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text variant="button" style={{ textDecorationLine: "underline" }}>
            Enter score
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function RoundCard({
  round,
  myPlayerId,
  onEnterScore,
}: {
  round: ScheduleRound;
  myPlayerId: number | null | undefined;
  onEnterScore: (m: ScheduleMatch) => void;
}) {
  const matches = round.matches;
  return (
    <Card style={{ gap: spacing.space1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.space2 }}>
        <View style={{ flexShrink: 1, gap: 2 }} accessible accessibilityRole="header" accessibilityLabel={`Round ${round.roundNumber}, ${dateRange(round.startDate, round.deadline)}. ${phaseLabel(round.phase)}`}>
          <Text variant="label" tone="inkMuted">
            {`Round ${round.roundNumber}`}
          </Text>
          <Text variant="bodyStrong">{dateRange(round.startDate, round.deadline)}</Text>
        </View>
        <Chip label={phaseLabel(round.phase)} />
      </View>
      {round.phase === "open" || round.phase === "upcoming" ? (
        <Text variant="small" tone="inkMuted">
          {`Play by ${shortDate(round.deadline)}. Grace week until ${shortDate(round.graceEnd)}.`}
        </Text>
      ) : null}
      {round.phase === "grace" ? (
        <Text variant="small" tone="inkMuted">
          {`Grace week until ${shortDate(round.graceEnd)}. Scores now count for ratings and stats, not standings.`}
        </Text>
      ) : null}
      <View>
        {matches.map((m, i) => (
          <MatchRow
            key={m.matchId}
            m={m}
            round={round}
            myPlayerId={myPlayerId}
            onEnterScore={onEnterScore}
            last={i === matches.length - 1 && round.byes.length === 0}
          />
        ))}
        {round.byes.map((b) => (
          <View
            key={b.playerId}
            accessible
            accessibilityLabel={`${b.playerName}${b.playerId === myPlayerId ? ", you," : ""} has a bye`}
            style={{ paddingVertical: spacing.space3, flexDirection: "row", gap: spacing.space2, alignItems: "center" }}
          >
            <Text variant="body" tone="inkMuted">
              {`Bye: ${b.playerName}${b.playerId === myPlayerId ? " (you)" : ""}`}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** A week later this season whose pairings haven't been made yet. */
export function UpcomingWeekRow({ week, last }: { week: ScheduleWeek; last: boolean }) {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityLabel={`Round ${week.roundNumber}, ${dateRange(week.startDate, week.deadline)}. Pairings go out ${shortDate(week.startDate)}`}
      style={{
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space2,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
      }}
    >
      <SymbolView name="calendar" size={18} tintColor={c.inkMuted} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{`Round ${week.roundNumber}`}</Text>
        <Text variant="small" tone="inkMuted">
          {`${dateRange(week.startDate, week.deadline)} · Pairings go out ${shortDate(week.startDate)}`}
        </Text>
      </View>
    </View>
  );
}
