import { useAuth } from "@clerk/expo";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { AccessibilityInfo, ActionSheetIOS, ActivityIndicator, Alert, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetLeagueAdminsQueryKey,
  getGetLeagueInvitesQueryKey,
  getGetLeagueJoinRequestsQueryKey,
  getGetLeagueRosterQueryKey,
  getGetLeaguesQueryKey,
  useApproveLeagueJoinRequest,
  useCreateLeagueInvite,
  useDeclineLeagueJoinRequest,
  useDeleteLeague,
  useDraftNextLeagueRound,
  useEndLeague,
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

import { InviteCard } from "@/components/league/InviteCard";
import { ListRow, SectionLabel } from "@/components/league/ListRow";
import { TestingTools } from "@/components/league/TestingTools";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { shortDate, weeklyMatchTime } from "@/lib/leagueSchedule";
import { refreshLeague } from "@/lib/leagueRefresh";
import { leagueLevelLabel } from "@/lib/onboarding";

// Manage (spec: Roles: "Admin tools appear in context only: a Manage entry
// inside leagues you run"). The invite card (code, copy, share) at the top
// (finding 29), then pairings, requests and the waitlist, players and admins.
// Reviewing a drafted round happens from the card on League detail, so
// Manage has no Review pairings entry (finding 29).

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
  const endLeague = useEndLeague();
  const deleteLeague = useDeleteLeague();

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
  const ended = !!league?.endedAt;

  const myPlayerId = membershipQ.data?.playerId ?? null;

  // Joining locks once the season starts or the league is full (decision 30).
  const started = !!league?.startDate && !!schedule && schedule.today >= league.startDate;
  const full = !!league && league.rosterCap != null && league.playerCount >= league.rosterCap;
  const inviteNote =
    !started && !full
      ? league?.startDate
        ? `Players join with this code or link until the season starts ${shortDate(league.startDate)}.`
        : "Players join with this code or link until the season starts."
      : "Late joiners ask to join, and you approve them below.";

  // C4: Manage's own lists, plus everything that shows the league (Home included).
  const refreshAll = () =>
    Promise.all([
      ...[
        getGetLeagueRosterQueryKey(leagueId),
        getGetLeagueAdminsQueryKey(leagueId),
        getGetLeagueJoinRequestsQueryKey(leagueId),
        getGetLeagueInvitesQueryKey(leagueId),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      refreshLeague(queryClient, leagueId),
    ]);

  // C19: a decline that didn't go through says so, and the request stays.
  const declineRequest = (r: JoinRequest) =>
    decline
      .mutateAsync({ leagueId, requestId: r.id })
      .then(refreshAll)
      .catch(async () => {
        Alert.alert("Couldn't decline", "Try again.");
        await refreshAll().catch(() => undefined);
      });

  // Decision 31: end the league. Standings freeze; history stays.
  function confirmEnd() {
    if (!league || endLeague.isPending) return;
    Alert.alert(
      `End ${league.name}?`,
      "Standings freeze where they are and no more scores can be entered. Pairings that haven't gone out are cancelled. Everything played stays, and the league moves to Past.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End league",
          style: "destructive",
          onPress: () =>
            endLeague
              .mutateAsync({ leagueId })
              .then(async () => {
                await refreshAll();
                AccessibilityInfo.announceForAccessibility(`${league.name} has ended`);
              })
              .catch((e) => Alert.alert("Couldn't end the league", errorText(e, "Try again in a moment."))),
        },
      ],
    );
  }

  // C10: delete the league, with its name typed to confirm.
  function confirmDelete() {
    if (!league || deleteLeague.isPending) return;
    const name = league.name;
    Alert.prompt(
      `Delete ${name}?`,
      `This deletes the league, its rounds and its matches for everyone, and can't be undone. Players' Ball Boi recordings and stats stay with them. Type ${name} to confirm.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete league",
          style: "destructive",
          onPress: (typed?: string) => {
            const tidy = (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase();
            if (tidy(typed ?? "") !== tidy(name)) {
              Alert.alert("The name doesn't match", `Type ${name} exactly to delete it.`);
              return;
            }
            deleteLeague
              .mutateAsync({ leagueId, data: { confirmName: typed ?? "" } })
              .then(async () => {
                await queryClient.invalidateQueries({ queryKey: getGetLeaguesQueryKey().slice(0, 1) });
                AccessibilityInfo.announceForAccessibility(`${name} was deleted`);
                router.dismissTo("/(tabs)/leagues");
              })
              .catch((e) => Alert.alert("Couldn't delete the league", errorText(e, "Try again in a moment.")));
          },
        },
      ],
      "plain-text",
      "",
      "default",
    );
  }

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
    // C26: you leave from the league's page, so your own row has no Remove.
    const isMe = myPlayerId != null && p.playerId === myPlayerId;
    const options = [...(canPromote ? ["Make co-admin"] : []), ...(isMe ? [] : ["Remove from league"]), "Cancel"];
    if (options.length === 1) return;
    const destructive = options.indexOf("Remove from league");
    ActionSheetIOS.showActionSheetWithOptions(
      { title: p.name, options, destructiveButtonIndex: destructive >= 0 ? destructive : undefined, cancelButtonIndex: options.length - 1 },
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
                    .mutateAsync({ leagueId, playerId: p.playerId, data: {} })
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
          onPress: () => void declineRequest(r),
        },
      ]);
      return;
    }
    const options = ["Approve", "Decline", "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: `${r.playerName} · ${leagueLevelLabel(r)}`, options, destructiveButtonIndex: 1, cancelButtonIndex: 2 },
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
        if (i === 1) void declineRequest(r);
      },
    );
  }

  // Leagues made before codes were automatic may have none: make one here.
  async function makeInvite() {
    try {
      await createInvite.mutateAsync({ leagueId, data: {} });
      await refreshAll();
      AccessibilityInfo.announceForAccessibility("Invite code created");
    } catch (e) {
      Alert.alert("Couldn't create an invite code", errorText(e, "Try again in a moment."));
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

  const refreshing = rosterQ.isRefetching || scheduleQ.isRefetching || requestsQ.isRefetching || invitesQ.isRefetching;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space2 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} tintColor={c.ink} />}
    >
      <View style={{ gap: spacing.space1, marginBottom: spacing.space2 }}>
        {/* Page title in the heading style (Cormorant at 50% ink), the league under it. */}
        <Text variant="headingM" accessibilityRole="header">
          Manage
        </Text>
        {league?.name ? <Text tone="inkMuted">{league.name}</Text> : null}
      </View>

      {/* Finding 29: the invite lives here, at the top, not on League detail. */}
      {!ended && !seasonOver ? (
        <View style={{ marginBottom: spacing.space2 }}>
          <InviteCard
            leagueName={league?.name ?? "my league"}
            code={invite?.code ?? null}
            loading={invitesQ.isLoading}
            onRetry={() => void invitesQ.refetch()}
            onCreate={invitesQ.isSuccess && !invite ? () => void makeInvite() : undefined}
            creating={createInvite.isPending}
            note={inviteNote}
          />
        </View>
      ) : null}

      {/* A drafted round is reviewed from the card on League detail (finding 29),
          so Pairings only shows when there's nothing waiting for review. */}
      {draft ? null : (
        <>
          <SectionLabel>Pairings</SectionLabel>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {!schedule?.weeklyRounds ? (
              <ListRow title="Weekly pairing isn't available for this league yet" subtitle="Doubles pairing is coming." last />
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
        </>
      )}

      {/* PR 4: a club's weekly match day and time, or players pick. */}
      {schedule?.weeklyRounds && !league?.endedAt ? (
        <>
          <SectionLabel>Match time</SectionLabel>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <ListRow
              title="Weekly match time"
              subtitle={weeklyMatchTime(league?.matchDay, league?.matchTime, league?.timeZone) ?? "Players pick a time for each match."}
              symbol="calendar"
              onPress={() => router.push(`/league/${leagueId}/match-time`)}
              accessibilityHint="Set one day and time for every match, or let players pick"
              last
            />
          </Card>
        </>
      ) : null}

      {/* Q9: after End, scores are final, so there's nothing to correct. */}
      {schedule?.weeklyRounds && !ended && !seasonOver ? (
        <>
          <SectionLabel>Scores</SectionLabel>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <ListRow
              title="Correct a score"
              subtitle="Fix a played match. Players can edit their own score for 24 hours after it's entered."
              symbol="pencil"
              onPress={() => router.push(`/league/${leagueId}/scores`)}
              last
            />
          </Card>
        </>
      ) : null}

      {requests.length > 0 ? (
        <>
          <SectionLabel>{`Requests to join (${requests.length})`}</SectionLabel>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {requests.map((r, i) => (
              <ListRow
                key={r.id}
                title={r.playerName}
                subtitle={leagueLevelLabel(r)}
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
                subtitle={`${leagueLevelLabel(r)} · Asked ${shortDate(r.createdAt.slice(0, 10))}`}
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
          <ListRow title="No players yet" subtitle="Share the invite code above." last />
        ) : (
          roster.map((p, i) => {
            const isMe = myPlayerId != null && p.playerId === myPlayerId;
            const canPromote = p.hasAccount && !p.role;
            return (
              <ListRow
                key={p.playerId}
                title={isMe ? `${p.name} (you)` : p.name}
                subtitle={leagueLevelLabel(p)}
                tag={roleLabel(p.role)}
                onPress={isMe && !canPromote ? undefined : () => playerMenu(p)}
                accessibilityHint={isMe ? undefined : canPromote ? "Make co-admin or remove from league" : "Remove from league"}
                last={i === roster.length - 1}
              />
            );
          })
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
              tag={roleLabel(a.role)}
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

      <SectionLabel>League</SectionLabel>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {ended ? (
          <ListRow title="This league has ended" subtitle="Standings are final. Everything played stays." symbol="flag.checkered" />
        ) : (
          <ListRow
            title="End league"
            subtitle="Freeze standings and move it to Past."
            symbol="flag.checkered"
            destructive
            onPress={confirmEnd}
            accessibilityHint="Asks you to confirm"
          />
        )}
        <ListRow
          title="Delete league"
          subtitle="Remove it for everyone. Type its name to confirm."
          symbol="trash"
          destructive
          onPress={confirmDelete}
          accessibilityHint="Asks you to type the league's name"
          last
        />
      </Card>

      {!ended ? <TestingTools leagueId={leagueId} onChanged={refreshAll} /> : null}
    </ScrollView>
  );
}
