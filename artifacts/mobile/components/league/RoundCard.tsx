import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View } from "react-native";

import type { ScheduleMatch, ScheduleRound, ScheduleWeek } from "@workspace/api-client-react";

import { Card, Chip, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import {
  canEnterScore,
  correctionLine,
  dateRange,
  deadlineDate,
  isMine,
  isNotPlayed,
  matchTitle,
  opponentName,
  phaseLabel,
  resultLine,
  shortDate,
} from "@/lib/leagueSchedule";

import { UndoScore } from "./UndoScore";

// One week of a league season (spec: Leagues > Weekly loop). Every state is in
// words: "This week", "Grace week", "Cancelled", "Not played yet", "Not played".

function MatchRow({
  leagueId,
  m,
  round,
  myPlayerId,
  onEnterScore,
  ended,
  last,
}: {
  leagueId: number;
  m: ScheduleMatch;
  round: ScheduleRound;
  myPlayerId: number | null | undefined;
  onEnterScore: (m: ScheduleMatch) => void;
  ended: boolean;
  last: boolean;
}) {
  const c = useColors();
  const mine = isMine(m, myPlayerId);
  // C24: once the league has ended, nothing is "Not played yet".
  const result = resultLine(m, round, ended);
  const notPlayed = isNotPlayed(round, m, ended);
  const notes = [
    m.inGrace ? "Grace week: counts for Ball Boi stats, not standings" : null,
    correctionLine(m),
    m.status !== "completed" && m.scoreClearedBy ? `Score cleared by ${m.scoreClearedBy}` : null,
  ].filter((n): n is string => !!n);
  const scoreable = mine && canEnterScore(round, m, ended);
  const summary = `${matchTitle(m).replace(" vs. ", " versus ")}. ${result}.${notes.map((n) => ` ${n}.`).join("")}`;

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
        <Text variant="bodyStrong">{matchTitle(m)}</Text>
        {notPlayed ? (
          // C6: in words with an icon, never color alone. No standings effect.
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space1 }}>
            <SymbolView name="minus.circle" size={14} tintColor={c.inkMuted} />
            <Text variant="small" tone="inkMuted">
              {result}
            </Text>
          </View>
        ) : (
          <Text variant="small" tone="inkMuted" style={m.voided ? { textDecorationLine: "line-through" } : undefined}>
            {result}
          </Text>
        )}
        {notes.map((n) => (
          <Text key={n} variant="small" tone="inkMuted">
            {n}
          </Text>
        ))}
      </View>
      {scoreable ? (
        <Pressable
          onPress={() => onEnterScore(m)}
          accessibilityRole="button"
          accessibilityLabel="Enter score"
          accessibilityHint={`For your match against ${opponentName(m, myPlayerId!)}`}
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
      ) : mine ? (
        <UndoScore leagueId={leagueId} matchId={m.matchId} undoUntil={m.undoUntil} />
      ) : null}
    </View>
  );
}

export function RoundCard({
  leagueId,
  round,
  myPlayerId,
  onEnterScore,
  ended = false,
  timeZone,
}: {
  leagueId: number;
  round: ScheduleRound;
  myPlayerId: number | null | undefined;
  onEnterScore: (m: ScheduleMatch) => void;
  /** The league has ended (decision 31): no more scores. */
  ended?: boolean;
  /** The league's time zone, named on deadlines when it isn't the viewer's (PR 4). */
  timeZone?: string | null;
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
      {!ended && (round.phase === "open" || round.phase === "upcoming") ? (
        <Text variant="small" tone="inkMuted">
          {`Play by ${deadlineDate(round.deadline, timeZone)}. Grace week until ${deadlineDate(round.graceEnd, timeZone)}.`}
        </Text>
      ) : null}
      {!ended && round.phase === "grace" ? (
        <Text variant="small" tone="inkMuted">
          {`Grace week until ${deadlineDate(round.graceEnd, timeZone)}. Scores now count for Ball Boi stats, not standings.`}
        </Text>
      ) : null}
      <View>
        {matches.map((m, i) => (
          <MatchRow
            key={m.matchId}
            leagueId={leagueId}
            m={m}
            round={round}
            myPlayerId={myPlayerId}
            onEnterScore={onEnterScore}
            ended={ended}
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
