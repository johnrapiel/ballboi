import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetLeagueTeamsQueryKey,
  getGetMyPartnerQueryKey,
  useGetLeagueTeams,
  useSplitLeagueTeam,
  useTeamUpPlayers,
  type LeagueTeams,
  type LeagueTeamsUnpairedItem,
} from "@workspace/api-client-react";

import { Icon } from "@/components/Icon";
import { ListRow, SectionLabel } from "@/components/league/ListRow";
import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { teamName, teamSpoken, unpairedLabel } from "@/lib/doubles";
import { refreshLeague } from "@/lib/leagueRefresh";

// Manage > Teams (doubles flow review D2, D4, D9, John, Nov 9), for a
// fixed-partner doubles league's admins:
// - Players without a partner, highest level first, each marked in words:
//   Needs a partner (theirs left, D4), Looking for a partner (D9), or No
//   partner yet. Pick two, then Team up, the primary action at the bottom.
//   A re-teamed player's new team starts 0-0.
// - Teams, each with Split (red, confirmed). Splitting cancels the team's
//   unplayed matches.
// Anyone still without a partner when the first round goes out is teamed by
// level automatically, so this is optional before then.

const errorText = (e: unknown) => (e as { data?: { error?: string } | null }).data?.error ?? "Try again in a moment.";

/** One player without a partner: tap to pick. Picked shows a check and the word, never color alone. */
function PickRow({ p, picked, onPress, last }: { p: LeagueTeamsUnpairedItem; picked: boolean; onPress: () => void; last: boolean }) {
  const c = useColors();
  const status = unpairedLabel(p.kind);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: picked }}
      accessibilityLabel={`${p.name}, level ${p.level.toFixed(1)}, ${status}`}
      accessibilityHint={picked ? "Unpicks this player" : "Picks this player to team up"}
      style={({ pressed }) => ({
        minHeight: Math.max(52, MIN_TAP),
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space2,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
        backgroundColor: picked ? c.sand : undefined,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={picked ? "checkmark.circle.fill" : "circle"} size={22} tintColor={c.ink} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{p.name}</Text>
        <Text variant="small" tone="inkMuted">
          {`Level ${p.level.toFixed(1)} · ${status}${picked ? " · Picked" : ""}`}
        </Text>
      </View>
      {p.kind === "needs_partner" ? <Icon name="exclamationmark.circle" size={18} tintColor={c.ink} /> : null}
    </Pressable>
  );
}

export default function TeamsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { leagueId: raw } = useLocalSearchParams<{ leagueId: string }>();
  const leagueId = Number(raw);
  const q = useGetLeagueTeams(leagueId);
  const pull = usePullToRefresh(() => q.refetch());
  const teamUp = useTeamUpPlayers();
  const split = useSplitLeagueTeam();
  const [picked, setPicked] = useState<number[]>([]);
  const data = q.data;
  // Team up sits below the list when it shows; either way the last team keeps a full gap (decision 194).
  const showTeamUp = !!data && data.unpaired.length >= 2;
  const bottom = useScreenBottomInset({ barBelow: showTeamUp });

  const settle = async (view: LeagueTeams, said: string) => {
    queryClient.setQueryData(getGetLeagueTeamsQueryKey(leagueId), view);
    setPicked([]);
    await Promise.all([refreshLeague(queryClient, leagueId), queryClient.invalidateQueries({ queryKey: getGetMyPartnerQueryKey(leagueId) })]);
    AccessibilityInfo.announceForAccessibility(said);
  };

  const toggle = (id: number) =>
    setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : now.length >= 2 ? [now[1], id] : [...now, id]));

  const names = (ids: number[]) => ids.map((id) => data?.unpaired.find((u) => u.playerId === id)?.name ?? "Player");

  function confirmTeamUp() {
    if (picked.length !== 2) return;
    const [a, b] = names(picked);
    Alert.alert(`Team up ${a} and ${b}?`, data?.firstRoundOut ? "They start at 0-0 and play together from the next round." : "They'll play every round together this season.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Team up",
        onPress: () =>
          teamUp
            .mutateAsync({ leagueId, data: { playerIds: picked } })
            .then((v) => settle(v, `${a} and ${b} are teamed up`))
            .catch((e) => Alert.alert("Couldn't team them up", errorText(e))),
      },
    ]);
  }

  function confirmSplit(teamId: number, players: string[]) {
    Alert.alert(
      `Split ${teamSpoken(players)}?`,
      data?.firstRoundOut
        ? "Their unplayed matches are cancelled and their opponents are told. Played results stay. Each of them will need a new partner."
        : "Each of them will need a new partner.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Split team",
          style: "destructive",
          onPress: () =>
            split
              .mutateAsync({ leagueId, teamId })
              .then((v) => settle(v, "Team split"))
              .catch((e) => Alert.alert("Couldn't split the team", errorText(e))),
        },
      ],
    );
  }

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading teams" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: bottom.paddingBottom, gap: spacing.space2 }}
        scrollIndicatorInsets={bottom.scrollIndicatorInsets}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink} />}
      >
        <View style={{ gap: spacing.space1, marginBottom: spacing.space2 }}>
          <Text variant="headingM" accessibilityRole="header">
            Teams
          </Text>
          <Text tone="inkMuted">
            {data?.firstRoundOut
              ? "Pick two players without a partner to team them up. A new team starts at 0-0."
              : "Players team up when they join. Pick two without a partner to team them up yourself. Anyone left when the first round goes out is teamed by level."}
          </Text>
        </View>

        {q.isError || !data ? (
          <Card style={{ gap: spacing.space3 }}>
            <Text variant="bodyStrong">Couldn't load teams</Text>
            <Text tone="inkMuted">Check your connection and try again.</Text>
            <Button label="Try again" variant="secondary" onPress={() => void q.refetch()} />
          </Card>
        ) : (
          <>
            <SectionLabel>{`Without a partner (${data.unpaired.length})`}</SectionLabel>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {data.unpaired.length === 0 ? (
                <ListRow title="Everyone has a partner" symbol="checkmark.circle" last />
              ) : (
                data.unpaired.map((p, i) => (
                  <PickRow key={p.playerId} p={p} picked={picked.includes(p.playerId)} onPress={() => toggle(p.playerId)} last={i === data.unpaired.length - 1} />
                ))
              )}
            </Card>

            {/* No dead end: one player alone can't be teamed until someone else is free. */}
            {data.unpaired.length === 1 ? (
              <Text variant="small" tone="inkMuted">
                {data.canLetInWaitlisted
                  ? `To team up ${data.unpaired[0].name}, let a player in from the waitlist in Manage, or split a team.`
                  : `To team up ${data.unpaired[0].name}, invite another player or split a team. Until then they have a bye each round.`}
              </Text>
            ) : null}

            <SectionLabel>{`Teams (${data.teams.length})`}</SectionLabel>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {data.teams.length === 0 ? (
                <ListRow title="No teams yet" subtitle="Teams show here as players team up." last />
              ) : (
                data.teams.map((t, i) => {
                  const players = t.players.map((p) => p.name);
                  return (
                    <ListRow
                      key={t.teamId}
                      title={teamName(players)}
                      subtitle={t.players.map((p) => `Level ${p.level.toFixed(1)}`).join(" · ")}
                      trailing="Split"
                      onPress={() => confirmSplit(t.teamId, players)}
                      accessibilityHint={`Splits ${teamSpoken(players)}. Asks you to confirm`}
                      last={i === data.teams.length - 1}
                    />
                  );
                })
              )}
            </Card>
          </>
        )}
      </ScrollView>

      {/* The primary action in the same place as every screen: pinned at the bottom. */}
      {showTeamUp ? (
        <View style={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space3, borderTopWidth: 1, borderTopColor: c.hairline, backgroundColor: c.paper, gap: spacing.space2 }}>
          <Text variant="small" tone="inkMuted" accessibilityLiveRegion="polite">
            {picked.length === 2 ? `${names(picked).join(" and ")} picked.` : picked.length === 1 ? `${names(picked)[0]} picked. Pick one more.` : "Pick two players to team up."}
          </Text>
          <Button label="Team up" onPress={confirmTeamUp} disabled={picked.length !== 2} loading={teamUp.isPending} />
        </View>
      ) : null}
    </View>
  );
}
