import { useAuth } from "@clerk/expo";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, RefreshControl, ScrollView, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetLeagueAdminsQueryKey,
  getGetLeagueInvitesQueryKey,
  getGetLeagueJoinRequestsQueryKey,
  getGetLeagueQueryKey,
  getGetLeagueRosterQueryKey,
  getGetLeagueScheduleQueryKey,
  getGetLeagueStandingsQueryKey,
  useApproveLeagueJoinRequest,
  useCreateLeagueInvite,
  useDeclineLeagueJoinRequest,
  useDraftNextLeagueRound,
  useGetLeague,
  useGetLeagueAdmins,
  useGetLeagueInvites,
  useGetLeagueJoinRequests,
  useGetLeagueMembership,
  useGetLeagueRoster,
  useGetLeagueSchedule,
  usePromoteLeagueAdmin,
  useRemoveLeagueAdmin,
  useRemoveLeaguePlayer,
  type JoinRequest,
  type RosterPlayer,
} from "@workspace/api-client-react";

import { ListRow, SectionLabel } from "@/components/league/ListRow";
import { TestingTools } from "@/components/league/TestingTools";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { shortDate } from "@/lib/leagueSchedule";

// Manage (spec: Roles: "Admin tools appear in context only: a Manage entry
// inside leagues you run"). Pairings for review, requests and the waitlist,
// players, admins, and the invite code.

function errorText(e: unknown, fallback: string): string {
  return (e as { data?: { error?: string } | null }).data?.error ?? fallback;
}

function roleLabel(role: string | null | undefined): string | null {
  return role === "owner" ? "Creator" : role === "co_admin" ? "Co-admin" : null;
}

export default function ManageLeagueScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const { leagueId: raw } = useLocalSearchParams<{ leagueId: string }>();
  const leagueId = Number(raw);

  const leagueQ = useGetLeague(leagueId);
  const membershipQ = useGetLeagueMembership(leagueId);
  const scheduleQ = useGetLeagueSchedule(leagueId);
  const rosterQ = useGetLeagueRoster(leagueId);
  const adminsQ = useGetLeagueAdmins(leagueId);
  const requestsQ = useGetLeagueJoinRequests(leagueId);
  const invitesQ = useGetLeagueInvites(leagueId);

  const draftNext = useDraftNextLeagueRound();
  const promote = usePromoteLeagueAdmin();
  const removeAdmin = useRemoveLeagueAdmin();
  const removePlayer = useRemoveLeaguePlayer();
  const approve = useApproveLeagueJoinRequest();
  const decline = useDeclineLeagueJoinRequest();
  const createInvite = useCreateLeagueInvite();

  const league = leagueQ.data;
  const myRole = membershipQ.data?.role ?? null;
  const schedule = scheduleQ.data;
  const draft = schedule?.rounds.find((r) => r.phase === "draft");
  const roster = rosterQ.data ?? [];
  const admins = adminsQ.data ?? [];
  const requests = (requestsQ.data ?? []).filter((r) => r.kind === "request");
  const waitlist = (requestsQ.data ?? []).filter((r) => r.kind === "waitlist");
  const invite = invitesQ.data?.find((i) => i.isActive);
  const seasonOver = !!league && league.status === "completed";

  const refreshAll = () =>
    Promise.all(
      [
        getGetLeagueQueryKey(leagueId),
        getGetLeagueScheduleQueryKey(leagueId),
        getGetLeagueRosterQueryKey(leagueId),
        getGetLeagueAdminsQueryKey(leagueId),
        getGetLeagueJoinRequestsQueryKey(leagueId),
        getGetLeagueStandingsQueryKey(leagueId),
        getGetLeagueInvitesQueryKey(leagueId),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );

  async function prepareNext() {
    try {
      const round = await draftNext.mutateAsync({ leagueId });
      await refreshAll();
      router.push(`/league/${leagueId}/round/${round.roundId}`);
    } catch (e) {
      Alert.alert("Couldn't prepare pairings", errorText(e, "Try again in a moment."));
    }
  }

  function playerMenu(p: RosterPlayer) {
    const canPromote = p.hasAccount && !p.role;
    const options = [...(canPromote ? ["Make co-admin"] : []), "Remove from league", "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: p.name, options, destructiveButtonIndex: options.indexOf("Remove from league"), cancelButtonIndex: options.length - 1 },
      (i) => {
        if (options[i] === "Make co-admin") {
          promote
            .mutateAsync({ leagueId, data: { playerId: p.playerId } })
            .then(refreshAll)
            .catch((e) => Alert.alert("Couldn't make co-admin", errorText(e, "Try again in a moment.")));
        }
        if (options[i] === "Remove from league") {
          Alert.alert(
            `Remove ${p.name}?`,
            "Their played matches stay. Their remaining matches are cancelled, their opponents are told, and they leave the standings.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Remove",
                style: "destructive",
                onPress: () =>
                  removePlayer
                    .mutateAsync({ leagueId, playerId: p.playerId })
                    .then(refreshAll)
                    .catch((e) => Alert.alert("Couldn't remove player", errorText(e, "Try again in a moment."))),
              },
            ],
          );
        }
      },
    );
  }

  function adminMenu(a: { clerkUserId: string; name: string; role: string }) {
    const isMe = a.clerkUserId === userId;
    if (a.role === "owner") return;
    if (!isMe && myRole !== "owner") return;
    const action = isMe ? "Step down as co-admin" : "Remove as co-admin";
    Alert.alert(isMe ? "Step down as co-admin?" : `Remove ${a.name} as co-admin?`, isMe ? "You'll still play in the league if you're on the roster." : `${a.name} stays in the league as a player.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: isMe ? "Step down" : "Remove",
        style: "destructive",
        onPress: () =>
          removeAdmin
            .mutateAsync({ leagueId, clerkUserId: a.clerkUserId })
            .then(async () => {
              await refreshAll();
              if (isMe) router.back();
            })
            .catch((e) => Alert.alert(`Couldn't ${action.toLowerCase()}`, errorText(e, "Try again in a moment."))),
      },
    ]);
  }

  function requestMenu(r: JoinRequest) {
    if (r.kind === "waitlist") {
      Alert.alert(`Remove ${r.playerName} from the waitlist?`, undefined, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => decline.mutateAsync({ leagueId, requestId: r.id }).then(refreshAll).catch(() => {}),
        },
      ]);
      return;
    }
    const options = ["Approve", "Decline", "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: `${r.playerName} · ${r.skillLevel}`, options, destructiveButtonIndex: 1, cancelButtonIndex: 2 },
      (i) => {
        if (i === 0) {
          approve
            .mutateAsync({ leagueId, requestId: r.id })
            .then(refreshAll)
            .catch(async (e) => {
              await refreshAll();
              Alert.alert("Couldn't approve", errorText(e, "Try again in a moment."));
            });
        }
        if (i === 1) decline.mutateAsync({ leagueId, requestId: r.id }).then(refreshAll).catch(() => {});
      },
    );
  }

  async function shareInvite() {
    try {
      const code = invite?.code ?? (await createInvite.mutateAsync({ leagueId, data: {} })).code;
      if (!invite) await refreshAll();
      await Share.share({
        message: `Join ${league?.name ?? "my league"} on Ball Boi. Open the app, go to Leagues, and enter code ${code}.`,
      });
    } catch (e) {
      Alert.alert("Couldn't share the invite", errorText(e, "Try again in a moment."));
    }
  }

  if (leagueQ.isLoading || membershipQ.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />
      </View>
    );
  }

  if (!membershipQ.data?.isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space4 }}>
        <Card>
          <Text>Only this league's admins can manage it.</Text>
        </Card>
      </View>
    );
  }

  const refreshing = rosterQ.isRefetching || scheduleQ.isRefetching || requestsQ.isRefetching;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space2 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} tintColor={c.ink} />}
    >
      <View style={{ gap: spacing.space1, marginBottom: spacing.space2 }}>
        <Text variant="label" tone="inkMuted">
          {league?.name ?? ""}
        </Text>
        <Text variant="displayL" accessibilityRole="header">
          Manage
        </Text>
      </View>

      <SectionLabel>Pairings</SectionLabel>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {!schedule?.weeklyRounds ? (
          <ListRow title="Weekly pairing isn't available for this league yet" subtitle="Doubles pairing is coming." last />
        ) : draft ? (
          <ListRow
            title={`Review Round ${draft.roundNumber} pairings`}
            subtitle={`Goes out to players ${shortDate(draft.startDate)} at 7am, or send it sooner.`}
            symbol="person.2"
            onPress={() => router.push(`/league/${leagueId}/round/${draft.roundId}`)}
            last
          />
        ) : seasonOver ? (
          <ListRow title="This season's rounds are done" last />
        ) : (
          <View style={{ padding: spacing.space4, gap: spacing.space3 }}>
            <Text tone="inkMuted">
              Pairings are drafted the day before each round, and you get a notification to review them. Prepare them now to review early.
            </Text>
            <Button label="Prepare next round" variant="secondary" loading={draftNext.isPending} onPress={() => void prepareNext()} />
          </View>
        )}
      </Card>

      {requests.length > 0 ? (
        <>
          <SectionLabel>{`Requests to join (${requests.length})`}</SectionLabel>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {requests.map((r, i) => (
              <ListRow
                key={r.id}
                title={r.playerName}
                subtitle={`Rating ${r.skillLevel}`}
                trailing="Review"
                onPress={() => requestMenu(r)}
                accessibilityHint="Approve or decline"
                last={i === requests.length - 1}
              />
            ))}
          </Card>
        </>
      ) : null}

      {waitlist.length > 0 ? (
        <>
          <SectionLabel>{`Waitlist for next season (${waitlist.length})`}</SectionLabel>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {waitlist.map((r, i) => (
              <ListRow
                key={r.id}
                title={r.playerName}
                subtitle={`Rating ${r.skillLevel} · Asked ${shortDate(r.createdAt.slice(0, 10))}`}
                onPress={() => requestMenu(r)}
                accessibilityHint="Remove from the waitlist"
                last={i === waitlist.length - 1}
              />
            ))}
          </Card>
        </>
      ) : null}

      <SectionLabel>{`Players (${roster.length})`}</SectionLabel>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {roster.length === 0 ? (
          <ListRow title="No players yet" subtitle="Share the invite code below." last />
        ) : (
          roster.map((p, i) => (
            <ListRow
              key={p.playerId}
              title={p.name}
              subtitle={`Rating ${p.skillLevel}`}
              trailing={roleLabel(p.role)}
              onPress={() => playerMenu(p)}
              accessibilityHint={p.hasAccount && !p.role ? "Make co-admin or remove from league" : "Remove from league"}
              last={i === roster.length - 1}
            />
          ))
        )}
      </Card>

      <SectionLabel>Admins</SectionLabel>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {admins.map((a, i) => {
          const isMe = a.clerkUserId === userId;
          const actionable = a.role !== "owner" && (isMe || myRole === "owner");
          return (
            <ListRow
              key={a.clerkUserId}
              title={`${a.name}${isMe ? " (you)" : ""}`}
              trailing={roleLabel(a.role)}
              onPress={actionable ? () => adminMenu(a) : undefined}
              accessibilityHint={actionable ? (isMe ? "Step down as co-admin" : "Remove as co-admin") : undefined}
              last={i === admins.length - 1}
            />
          );
        })}
      </Card>
      <Text variant="small" tone="inkMuted">
        To add a co-admin, tap a player above.
      </Text>

      <SectionLabel>Invite players</SectionLabel>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <ListRow
          title={invite ? `Share invite code ${invite.code}` : "Create and share an invite code"}
          subtitle={
            league?.startDate ? `New players can join until the season starts ${shortDate(league.startDate)}.` : null
          }
          symbol="square.and.arrow.up"
          onPress={() => void shareInvite()}
          last
        />
      </Card>

      <TestingTools leagueId={leagueId} onChanged={refreshAll} />
    </ScrollView>
  );
}
