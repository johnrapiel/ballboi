import React from "react";
import { AccessibilityInfo, ActionSheetIOS, Alert, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetLeagueTeamsQueryKey,
  useCreateLeagueTeam,
  useDeleteLeagueTeam,
  useGetLeagueTeams,
  type LeagueTeam,
  type LeagueTeamPlayer,
} from "@workspace/api-client-react";

import { ListRow, SectionLabel } from "@/components/league/ListRow";
import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";

// Teams in a fixed-partner doubles league (Wave 2: doubles pairing). Admins
// team players up and split teams here. Anyone left without a partner when a
// round is drafted is teamed up automatically with the closest level.

function errorText(e: unknown): string {
  return (e as { data?: { error?: string } | null }).data?.error ?? "Try again in a moment.";
}

function teamName(t: LeagueTeam): string {
  return t.players.map((p) => p.name).join(" and ");
}

export function TeamsSection({ leagueId, ended }: { leagueId: number; ended: boolean }) {
  const queryClient = useQueryClient();
  const teamsQ = useGetLeagueTeams(leagueId);
  const create = useCreateLeagueTeam();
  const remove = useDeleteLeagueTeam();

  const teams = teamsQ.data?.teams ?? [];
  const unpartnered = teamsQ.data?.unpartnered ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetLeagueTeamsQueryKey(leagueId) });

  function teamUp(p: LeagueTeamPlayer) {
    const others = unpartnered.filter((o) => o.playerId !== p.playerId);
    if (others.length === 0) {
      Alert.alert("No one to team up with", "Everyone else already has a partner. Split a team first.");
      return;
    }
    const options = [...others.map((o) => o.name), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: `Team up ${p.name} with`, options, cancelButtonIndex: options.length - 1 },
      (i) => {
        const other = others[i];
        if (!other) return;
        create
          .mutateAsync({ leagueId, data: { playerAId: p.playerId, playerBId: other.playerId } })
          .then(refresh)
          .then(() => AccessibilityInfo.announceForAccessibility(`${p.name} and ${other.name} are a team`))
          .catch((e) => Alert.alert("Couldn't make the team", errorText(e)));
      },
    );
  }

  function confirmSplit(t: LeagueTeam) {
    Alert.alert(`Split ${teamName(t)}?`, "They keep their played matches. Each needs a new partner before the next round.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Split team",
        style: "destructive",
        onPress: () =>
          remove
            .mutateAsync({ leagueId, teamId: t.teamId })
            .then(refresh)
            .then(() => AccessibilityInfo.announceForAccessibility(`${teamName(t)} split`))
            .catch((e) => Alert.alert("Couldn't split the team", errorText(e))),
      },
    ]);
  }

  if (!teamsQ.data) return null;

  return (
    <>
      <SectionLabel>{`Teams (${teams.length})`}</SectionLabel>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {teams.length === 0 && unpartnered.length === 0 ? (
          <ListRow title="No teams yet" subtitle="Players get a partner when they join." last />
        ) : null}
        {teams.map((t, i) => (
          <ListRow
            key={t.teamId}
            title={teamName(t)}
            onPress={ended ? undefined : () => confirmSplit(t)}
            accessibilityHint={ended ? undefined : "Split this team"}
            last={i === teams.length - 1 && unpartnered.length === 0}
          />
        ))}
        {unpartnered.map((p, i) => (
          <ListRow
            key={p.playerId}
            title={p.name}
            subtitle="Needs a partner"
            symbol="person.crop.circle.badge.questionmark"
            onPress={ended ? undefined : () => teamUp(p)}
            accessibilityHint={ended ? undefined : "Pick a partner"}
            last={i === unpartnered.length - 1}
          />
        ))}
      </Card>
      <View style={{ paddingHorizontal: spacing.space1 }}>
        <Text variant="small" tone="inkMuted">
          Anyone still without a partner when pairings are made is teamed up with the closest level. Changes apply from the next round you prepare.
        </Text>
      </View>
    </>
  );
}
