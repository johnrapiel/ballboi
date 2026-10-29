import { useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetLeague, useGetLeagueStandings, useGetMyPlayers, type Standing } from "@workspace/api-client-react";

import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { formatLabel, ordinal, playersLabel, playTypeLabel } from "@/lib/leagues";

// League standings (spec: Leagues; canvas: League · Standings).
// Rounds, playoffs, chat, and Manage come in later PRs.

function StandingRow({ s, isMe, last }: { s: Standing; isMe: boolean; last: boolean }) {
  const c = useColors();
  const record = `${s.wins}–${s.losses}`;
  return (
    <View
      accessible
      accessibilityLabel={`${ordinal(s.rank)}, ${s.playerName}${isMe ? ", you" : ""}. ${s.wins} wins, ${s.losses} losses. ${s.points} points`}
      style={{
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        backgroundColor: isMe ? c.sand : "transparent",
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
      }}
    >
      <Text variant="titleItalic" tone={isMe ? "ink" : "inkMuted"} style={{ width: 28 }}>
        {s.rank}
      </Text>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.space2, flexWrap: "wrap" }}>
        <Text variant="bodyStrong">{s.playerName}</Text>
        {isMe ? (
          <Text variant="label" tone="inkMuted">
            You
          </Text>
        ) : null}
      </View>
      <Text variant="small" style={{ width: 44, textAlign: "right" }}>
        {record}
      </Text>
      <Text variant="title" style={{ minWidth: 44, textAlign: "right" }}>
        {s.points}
      </Text>
    </View>
  );
}

export default function LeagueStandingsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { leagueId: raw } = useLocalSearchParams<{ leagueId: string }>();
  const leagueId = Number(raw);

  const leagueQ = useGetLeague(leagueId);
  const standingsQ = useGetLeagueStandings(leagueId);
  const playersQ = useGetMyPlayers();

  const league = leagueQ.data;
  const standings = standingsQ.data ?? [];
  const myPlayerId = playersQ.data?.find((p) => p.leagueId === leagueId)?.id;

  const eyebrow = league
    ? [formatLabel(league.format), playTypeLabel(league.leagueType), league.location].filter(Boolean).join(" · ")
    : "";

  if (leagueQ.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading league" />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space4 }}
      refreshControl={
        <RefreshControl
          refreshing={standingsQ.isRefetching}
          onRefresh={() => {
            void leagueQ.refetch();
            void standingsQ.refetch();
          }}
          tintColor={c.ink}
        />
      }
    >
      {leagueQ.isError || !league ? (
        <Card style={{ gap: spacing.space2 }}>
          <Text variant="bodyStrong">Couldn't load this league</Text>
          <Text variant="small" tone="inkMuted">
            Pull down to try again.
          </Text>
        </Card>
      ) : (
        <>
          <View style={{ gap: spacing.space1 }}>
            <Text variant="label" tone="inkMuted">
              {eyebrow}
            </Text>
            <Text variant="displayL" accessibilityRole="header">
              {league.name}
            </Text>
            <Text variant="small" tone="inkMuted">
              {playersLabel(league.playerCount)}
            </Text>
          </View>

          <View style={{ gap: spacing.space2 }}>
            <Text variant="label" tone="inkMuted" accessibilityRole="header">
              Standings
            </Text>
            {standingsQ.isLoading ? (
              <ActivityIndicator color={c.ink} accessibilityLabel="Loading standings" />
            ) : standings.length === 0 ? (
              <Card>
                <Text tone="inkMuted">Standings show up here after the first scores are in.</Text>
              </Card>
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <View
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                  style={{
                    flexDirection: "row",
                    gap: spacing.space3,
                    paddingHorizontal: spacing.space4,
                    paddingVertical: spacing.space2,
                    borderBottomWidth: 1,
                    borderBottomColor: c.hairlineStrong,
                  }}
                >
                  <Text variant="label" tone="inkMuted" style={{ width: 28 }}>
                    #
                  </Text>
                  <Text variant="label" tone="inkMuted" style={{ flex: 1 }}>
                    Player
                  </Text>
                  <Text variant="label" tone="inkMuted" style={{ width: 44, textAlign: "right" }}>
                    W–L
                  </Text>
                  <Text variant="label" tone="inkMuted" style={{ minWidth: 44, textAlign: "right" }}>
                    Pts
                  </Text>
                </View>
                {standings.map((s, n) => (
                  <StandingRow key={s.playerId} s={s} isMe={s.playerId === myPlayerId} last={n === standings.length - 1} />
                ))}
              </Card>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}
