import { useUser } from "@clerk/expo";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetLeagueStandingsQueryOptions,
  getGetLeaguesQueryKey,
  getGetMyPlayersQueryKey,
  getInvite,
  joinLeagueViaInvite,
  useGetLeagues,
  useGetMyPlayers,
  type League,
  type Standing,
} from "@workspace/api-client-react";

import { IconButton } from "@/components/Choice";
import { EmptyState } from "@/components/EmptyState";
import { TabScreen } from "@/components/TabHeader";
import { Awning, Button, Card, Chip, Field, Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { formatLabel, ordinal, playersLabel, playTypeLabel, statusLabel } from "@/lib/leagues";

// Leagues tab (spec: Leagues; canvas: Leagues). Your current leagues as cards
// with your rank, past seasons as a list, and joining with an invite code.
// Start a league opens from the + button and from the empty state.

type MyStanding = { rank: number; points: number; behind: number } | null;

function myStanding(standings: Standing[] | undefined, myPlayerId: number | undefined): MyStanding {
  if (!standings || myPlayerId === undefined) return null;
  const mine = standings.find((s) => s.playerId === myPlayerId);
  if (!mine) return null;
  const leader = standings.reduce((max, s) => Math.max(max, s.points), 0);
  return { rank: mine.rank, points: mine.points, behind: leader - mine.points };
}

function Stat({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.sand,
        borderRadius: radius.radiusSm,
        paddingHorizontal: spacing.space3,
        paddingVertical: spacing.space2,
        gap: 2,
      }}
    >
      <Text variant="label" tone="inkMuted">
        {label}
      </Text>
      <Text variant="title">{value}</Text>
    </View>
  );
}

function LeagueCard({ league, standing, onPress }: { league: League; standing: MyStanding; onPress: () => void }) {
  const details = [league.location, playersLabel(league.playerCount)].filter(Boolean).join(" · ");
  const spoken = [
    league.name,
    statusLabel(league.status),
    `${formatLabel(league.format)}, ${playTypeLabel(league.leagueType)}`,
    details,
    standing ? `You're ${ordinal(standing.rank)} with ${standing.points} points` : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens standings"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ borderTopLeftRadius: radius.radiusMd, borderTopRightRadius: radius.radiusMd, overflow: "hidden" }}>
        <Awning />
      </View>
      <Card style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTopWidth: 0, gap: spacing.space3 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.space2 }}>
          <Text variant="label" tone="inkMuted" style={{ flexShrink: 1 }}>
            {formatLabel(league.format)} · {playTypeLabel(league.leagueType)}
          </Text>
          <Chip label={statusLabel(league.status)} tone={league.status === "active" ? "win" : "quiet"} />
        </View>
        <View style={{ gap: 2 }}>
          <Text variant="displayL">{league.name}</Text>
          {details ? (
            <Text variant="small" tone="inkMuted">
              {details}
            </Text>
          ) : null}
        </View>
        {standing ? (
          <View style={{ flexDirection: "row", gap: spacing.space2 }}>
            <Stat label="Your rank" value={ordinal(standing.rank)} />
            <Stat label="Points" value={String(standing.points)} />
            <Stat label={standing.rank === 1 ? "Leading" : "Behind 1st"} value={String(standing.behind)} />
          </View>
        ) : null}
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

function JoinWithCode() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const playerName =
    user?.fullName?.trim() || user?.firstName?.trim() || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "Player";

  async function join(cleaned: string) {
    setBusy(true);
    try {
      const result = await joinLeagueViaInvite(cleaned, { playerName });
      setCode("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetLeaguesQueryKey().slice(0, 1) }),
        queryClient.invalidateQueries({ queryKey: getGetMyPlayersQueryKey() }),
      ]);
      Alert.alert("You're in", `You joined ${result.league.name}.`);
    } catch {
      Alert.alert("Couldn't join", "Something went wrong joining this league. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function lookUp() {
    const cleaned = code.trim().toUpperCase();
    if (!cleaned) return;
    setBusy(true);
    try {
      const invite = await getInvite(cleaned);
      setBusy(false);
      const name = invite.leagueName ?? "this league";
      const players = invite.playerCount != null ? playersLabel(invite.playerCount) : null;
      Alert.alert(`Join ${name}?`, players ? `${players} so far.` : undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Join", onPress: () => void join(cleaned) },
      ]);
    } catch (e) {
      setBusy(false);
      const status = (e as { status?: number }).status;
      Alert.alert(
        status === 410 ? "This invite has ended" : "That code didn't work",
        status === 410 ? "Ask your organizer for a new invite." : "Check the code and try again.",
      );
    }
  }

  return (
    <Card style={{ gap: spacing.space3 }}>
      <Text variant="titleItalic" accessibilityRole="header">
        Got an invite?
      </Text>
      <Text variant="small" tone="inkMuted">
        Open the link your organizer sent, or enter the code here.
      </Text>
      <Field
        label="Invite code"
        value={code}
        onChangeText={setCode}
        placeholder="BEACON35"
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={lookUp}
      />
      <Button label="Join" onPress={lookUp} loading={busy} disabled={!code.trim()} />
    </Card>
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

          {current.map(({ league, i }) => (
            <LeagueCard key={league.id} league={league} standing={standingFor(league, i)} onPress={() => open(league)} />
          ))}

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

          <JoinWithCode />
        </ScrollView>
      )}
    </TabScreen>
  );
}
