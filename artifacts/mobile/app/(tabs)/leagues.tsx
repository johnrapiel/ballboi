import { useUser } from "@clerk/expo";
import { useQueries } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetLeagueStandingsQueryOptions,
  useGetLeagues,
  useGetMyPlayers,
  type League,
  type Standing,
} from "@workspace/api-client-react";

import { IconButton } from "@/components/Choice";
import { EmptyState } from "@/components/EmptyState";
import { TabScreen } from "@/components/TabHeader";
import { Button, Card, Chip, Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { formatLabel, ordinal, playersLabel, playTypeLabel, statusLabel } from "@/lib/leagues";

// Leagues tab (spec: Leagues; canvas: Leagues). Your current leagues as cards
// with your rank, past seasons as a list, and a row that opens the invite
// code sheet (app/league/join.tsx). The league card is the hero surface; the
// invite row is an unfilled, dashed action so the two never read as siblings.
// Start a league opens from the + button and from the empty state.

// Standings rank on wins only (decision 23).
type MyStanding = { rank: number; wins: number; behind: number; lead: number } | null;

function myStanding(standings: Standing[] | undefined, myPlayerId: number | undefined): MyStanding {
  if (!standings || myPlayerId === undefined) return null;
  const mine = standings.find((s) => s.playerId === myPlayerId);
  if (!mine) return null;
  const leader = standings.reduce((max, s) => Math.max(max, s.wins), 0);
  const nextBest = standings.filter((s) => s.playerId !== myPlayerId).reduce((max, s) => Math.max(max, s.wins), 0);
  return { rank: mine.rank, wins: mine.wins, behind: leader - mine.wins, lead: mine.wins - nextBest };
}

// Stats sit in one row split by hairlines, not in filled tiles, so the
// league card stays a single surface (design: Leagues hierarchy, Night).
function Stat({ label, value, first }: { label: string; value: string; first?: boolean }) {
  const c = useColors();
  return (
    <View
      style={{
        flex: 1,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        gap: spacing.space1,
        borderLeftWidth: first ? 0 : 1,
        borderLeftColor: c.hairline,
      }}
    >
      <Text variant="label" tone="inkMuted" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="title" style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>
        {value}
      </Text>
    </View>
  );
}

function LeagueCard({ league, standing, onPress }: { league: League; standing: MyStanding; onPress: () => void }) {
  const c = useColors();
  const details = [league.location, playersLabel(league.playerCount)].filter(Boolean).join(" · ");
  const spoken = [
    league.name,
    statusLabel(league.status),
    `${formatLabel(league.format)}, ${playTypeLabel(league.leagueType)}`,
    details,
    standing ? `You're ${ordinal(standing.rank)} with ${standing.wins} ${standing.wins === 1 ? "win" : "wins"}` : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the league"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card
        style={{
          borderColor: c.hairlineStrong,
          padding: 0,
        }}
      >
        <View style={{ padding: spacing.space4, gap: spacing.space3 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.space2 }}>
            <Text variant="label" tone="inkMuted" style={{ flexShrink: 1 }}>
              {formatLabel(league.format)} · {playTypeLabel(league.leagueType)}
            </Text>
            <Chip label={statusLabel(league.status)} tone={league.status === "active" ? "win" : "quiet"} />
          </View>
          <View style={{ gap: 2 }}>
            <Text variant="title">{league.name}</Text>
            {details ? (
              <Text variant="small" tone="inkMuted">
                {details}
              </Text>
            ) : null}
          </View>
        </View>
        {standing ? (
          <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: c.hairline }}>
            <Stat first label="Your rank" value={ordinal(standing.rank)} />
            <Stat label="Wins" value={String(standing.wins)} />
            {standing.lead > 0 ? (
              <Stat label="Ahead by" value={String(standing.lead)} />
            ) : (
              <Stat label="Behind 1st" value={String(standing.behind)} />
            )}
          </View>
        ) : null}
        <View
          style={{
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: spacing.space4,
            borderTopWidth: 1,
            borderTopColor: c.hairline,
          }}
        >
          <Text variant="button" tone="court">
            Open league
          </Text>
          <SymbolView name="chevron.right" size={14} tintColor={c.court} />
        </View>
      </Card>
    </Pressable>
  );
}

function PastLeagueRow({ league, standing, onPress, last }: { league: League; standing: MyStanding; onPress: () => void; last: boolean }) {
  const c = useColors();
  const sub = [league.location, formatLabel(league.format), standing ? `Finished ${ordinal(standing.rank)}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${league.name}. ${sub}. Done`}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{league.name}</Text>
        <Text variant="small" tone="inkMuted">
          {sub}
        </Text>
      </View>
      <Chip label="Done" />
    </Pressable>
  );
}

function InviteCodeRow({ onPress }: { onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Enter your invite code"
      accessibilityHint="Opens a sheet to join a league with a code"
      style={({ pressed }) => ({
        minHeight: 60,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        borderRadius: radius.radiusMd,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: c.hairlineStrong,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <SymbolView name="ticket" size={22} tintColor={c.ink} />
      <Text variant="bodyStrong" style={{ flex: 1 }}>
        Enter your invite code
      </Text>
      <SymbolView name="chevron.right" size={14} tintColor={c.inkMuted} />
    </Pressable>
  );
}

export default function LeaguesScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useUser();

  const leaguesQ = useGetLeagues(user?.id ? { clerkUserId: user.id } : undefined);
  const playersQ = useGetMyPlayers();
  const leagues = leaguesQ.data ?? [];

  const standingsQs = useQueries({
    queries: leagues.map((l) => getGetLeagueStandingsQueryOptions(l.id)),
  });

  const standingFor = (league: League, i: number) =>
    myStanding(standingsQs[i]?.data, playersQ.data?.find((p) => p.leagueId === league.id)?.id);

  const open = (league: League) =>
    router.push({ pathname: "/league/[leagueId]", params: { leagueId: String(league.id) } });

  const indexed = leagues.map((league, i) => ({ league, i }));
  const current = indexed.filter(({ league }) => league.status !== "completed");
  const past = indexed.filter(({ league }) => league.status === "completed");

  const refreshing = leaguesQ.isRefetching;
  const refresh = () => {
    void leaguesQ.refetch();
    void playersQ.refetch();
    standingsQs.forEach((q) => void q.refetch());
  };

  const startLeague = () => router.push("/league/new");

  return (
    <TabScreen title="Leagues" action={<IconButton symbol="plus" label="Start a league" onPress={startLeague} />}>
      {leaguesQ.isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading your leagues" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.space4,
            paddingBottom: insets.bottom + 120,
            gap: spacing.space6,
            flexGrow: 1,
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.ink} />}
        >
          {leaguesQ.isError ? (
            <Card style={{ gap: spacing.space2 }}>
              <Text variant="bodyStrong">Couldn't load your leagues</Text>
              <Text variant="small" tone="inkMuted">
                Pull down to try again.
              </Text>
            </Card>
          ) : null}

          {!leaguesQ.isError && leagues.length === 0 ? (
            <View style={{ minHeight: 240, gap: spacing.space4 }}>
              <EmptyState symbol="trophy" title="No leagues yet" message="Leagues you start or join show up here." />
              <Button label="Start a league" onPress={startLeague} />
            </View>
          ) : null}

          {current.length > 0 ? (
            <View style={{ gap: spacing.space3 }}>
              <Text variant="label" tone="inkMuted" accessibilityRole="header">
                Your leagues
              </Text>
              {current.map(({ league, i }) => (
                <LeagueCard key={league.id} league={league} standing={standingFor(league, i)} onPress={() => open(league)} />
              ))}
            </View>
          ) : null}

          {past.length > 0 ? (
            <View style={{ gap: spacing.space2 }}>
              <Text variant="label" tone="inkMuted" accessibilityRole="header">
                Past seasons
              </Text>
              <Card style={{ padding: 0 }}>
                {past.map(({ league, i }, n) => (
                  <PastLeagueRow
                    key={league.id}
                    league={league}
                    standing={standingFor(league, i)}
                    onPress={() => open(league)}
                    last={n === past.length - 1}
                  />
                ))}
              </Card>
            </View>
          ) : null}

          <InviteCodeRow onPress={() => router.push("/league/join")} />
        </ScrollView>
      )}
    </TabScreen>
  );
}
