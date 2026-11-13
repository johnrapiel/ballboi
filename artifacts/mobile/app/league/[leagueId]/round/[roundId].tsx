import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  useGetLeague,
  getGetLeagueScheduleQueryKey,
  useAddLeagueRoundBye,
  useGetLeagueRoster,
  useGetLeagueSchedule,
  useLockLeagueRoundMatch,
  usePublishLeagueRound,
  useRemoveLeagueRoundBye,
  useRepairLeagueRound,
  useSwapLeagueRoundPlayers,
  type ScheduleMatch,
  type ScheduleRound,
} from "@workspace/api-client-react";

import { useActionSheet, type SheetPage, type SheetPerson, type SheetRow } from "@/components/ActionSheet";
import { ProblemCard } from "@/components/discover/States";
import { ListRow } from "@/components/league/ListRow";
import { OfflineNotice } from "@/components/OfflineNotice";
import { Button, Card, Text, TextButton } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { dateRange, pairingTime, shortDate, sideLabels } from "@/lib/leagueSchedule";
import { swapCandidates } from "@/lib/swapCandidates";

// Review a round before it goes out (spec: Leagues > Weekly loop, step 2;
// approved canvas: Admin · Schedule review). A brush title, the matches as
// rows, Re-pair at the top right and Send at the bottom. Tap any row for its
// actions: swap a player, give a bye, lock the match. A bottom sheet, not
// gestures, so every action works with VoiceOver and Switch Control (decision
// 186: menus and pickers open in a bottom sheet; alerts only confirm).

function Heading({ children }: { children: string }) {
  return (
    <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ marginTop: spacing.space2, paddingHorizontal: spacing.space1 }}>
      {children}
    </Text>
  );
}

type Person = { playerId: number; name: string };

function errorText(e: unknown): string {
  return (e as { data?: { error?: string } | null }).data?.error ?? "Try again in a moment.";
}

/** Everyone placed in the round, for "Swap with…". */
function everyone(round: ScheduleRound): Person[] {
  return [
    ...round.matches.flatMap((m) => [
      { playerId: m.player1Id, name: m.player1Name },
      { playerId: m.player2Id, name: m.player2Name },
    ]),
    ...round.byes.map((b) => ({ playerId: b.playerId, name: b.playerName })),
    ...round.unpaired.map((u) => ({ playerId: u.playerId, name: u.playerName })),
  ];
}

export default function RoundReviewScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { leagueId: rawLeague, roundId: rawRound } = useLocalSearchParams<{ leagueId: string; roundId: string }>();
  const leagueId = Number(rawLeague);
  const roundId = Number(rawRound);

  const scheduleQ = useGetLeagueSchedule(leagueId);
  // Doubles drafts (D10): lock or re-pair; fixed teams change in Manage > Teams.
  const doubles = useGetLeague(leagueId).data?.leagueType === "doubles";
  const rosterQ = useGetLeagueRoster(leagueId);
  const pull = usePullToRefresh(() => scheduleQ.refetch());
  const [busy, setBusy] = useState(false);

  const swap = useSwapLeagueRoundPlayers();
  const addBye = useAddLeagueRoundBye();
  const removeBye = useRemoveLeagueRoundBye();
  const lock = useLockLeagueRoundMatch();
  const repair = useRepairLeagueRound();
  const publish = usePublishLeagueRound();
  const sheet = useActionSheet();

  const round = scheduleQ.data?.rounds.find((r) => r.roundId === roundId);
  const rating = (id: number) => rosterQ.data?.find((p) => p.playerId === id)?.skillLevel;
  const levelText = (id: number) => {
    const r = rating(id);
    return r ? `Level ${r}` : null;
  };

  /** Runs an edit, then shows the updated round and says what changed. */
  async function run(action: () => Promise<unknown>, done: string): Promise<boolean> {
    setBusy(true);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: getGetLeagueScheduleQueryKey(leagueId) });
      AccessibilityInfo.announceForAccessibility(done);
      return true;
    } catch (e) {
      Alert.alert("Couldn't change the pairings", errorText(e));
      void queryClient.invalidateQueries({ queryKey: getGetLeagueScheduleQueryKey(leagueId) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const rosterOf = (id: number) => rosterQ.data?.find((p) => p.playerId === id);
  const person = (p: Person): SheetPerson => ({ name: p.name, photo: rosterOf(p.playerId)?.avatarUrl, detail: levelText(p.playerId) });

  /** "Swap Maya Chen with": everyone else in the round, closest level first, never their current opponent. */
  function swapPage(r: ScheduleRound, p: Person, opponentId: number | null): SheetPage {
    const others = swapCandidates(everyone(r), p, opponentId, rating);
    return {
      title: `Swap ${p.name} with`,
      titleHasName: true,
      rows: others.map((o) => ({
        label: o.name,
        detail: levelText(o.playerId),
        person: { name: o.name, photo: rosterOf(o.playerId)?.avatarUrl },
        accessibilityLabel: [`Swap with ${o.name}`, levelText(o.playerId)].filter(Boolean).join(", "),
        onPress: () =>
          void run(
            () => swap.mutateAsync({ leagueId, roundId, data: { playerAId: p.playerId, playerBId: o.playerId } }),
            `Swapped ${p.name} and ${o.name}`,
          ),
      })),
      empty: "No one else to swap with.",
    };
  }

  function giveBye(p: Person) {
    void run(() => addBye.mutateAsync({ leagueId, roundId, data: { playerId: p.playerId } }), `${p.name} has a bye`);
  }

  function matchMenu(r: ScheduleRound, m: ScheduleMatch) {
    const a = { playerId: m.player1Id, name: doubles ? sideLabels(m).side1 : m.player1Name };
    const b = { playerId: m.player2Id, name: doubles ? sideLabels(m).side2 : m.player2Name };
    const lockRow: SheetRow = {
      label: m.locked ? "Unlock match" : "Lock match",
      icon: m.locked ? "lock" : "lock.fill",
      onPress: () =>
        void run(() => lock.mutateAsync({ leagueId, roundId, matchId: m.matchId, data: { locked: !m.locked } }), m.locked ? "Match unlocked" : "Match locked"),
    };
    const rows: SheetRow[] =
      doubles || m.locked
        ? [lockRow]
        : [
            { label: `Swap ${a.name} with…`, icon: "arrow.up.arrow.down", next: swapPage(r, a, b.playerId) },
            { label: `Swap ${b.name} with…`, icon: "arrow.up.arrow.down", next: swapPage(r, b, a.playerId) },
            { label: `Give ${a.name} a bye`, icon: "pause.circle", onPress: () => giveBye(a) },
            { label: `Give ${b.name} a bye`, icon: "pause.circle", onPress: () => giveBye(b) },
            lockRow,
          ];
    sheet.show({
      people: doubles ? [{ name: a.name }, { name: b.name }] : [person(a), person(b)],
      message: m.locked ? "Locked matches stay as they are when you re-pair." : undefined,
      rows,
    });
  }

  function byeMenu(r: ScheduleRound, p: Person) {
    sheet.show({
      people: [person(p)],
      message: "Has a bye this round.",
      rows: [
        {
          label: `Take away ${p.name}'s bye`,
          icon: "minus.circle",
          onPress: () => void run(() => removeBye.mutateAsync({ leagueId, roundId, playerId: p.playerId }), `${p.name} needs an opponent`),
        },
        { label: `Swap ${p.name} with…`, icon: "arrow.up.arrow.down", next: swapPage(r, p, null) },
      ],
    });
  }

  function unpairedMenu(r: ScheduleRound, p: Person) {
    sheet.show({
      people: [person(p)],
      message: "Needs an opponent.",
      rows: [
        { label: `Give ${p.name} a bye`, icon: "pause.circle", onPress: () => giveBye(p) },
        { label: `Swap ${p.name} with…`, icon: "arrow.up.arrow.down", next: swapPage(r, p, null) },
      ],
    });
  }

  function confirmRepair() {
    Alert.alert("Re-pair this round?", "Locked matches and byes you set stay. Everyone else gets new pairings.", [
      { text: "Cancel", style: "cancel" },
      { text: "Re-pair", onPress: () => void run(() => repair.mutateAsync({ leagueId, roundId }), "Round re-paired") },
    ]);
  }

  function confirmPublish(r: ScheduleRound) {
    Alert.alert(
      `Send Round ${r.roundNumber} to players now?`,
      "Everyone gets a notification with their opponent. You can't change the pairings after this.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          onPress: () =>
            void run(() => publish.mutateAsync({ leagueId, roundId }), `Round ${r.roundNumber} sent to players`).then((ok) => {
              if (ok) router.back();
            }),
        },
      ],
    );
  }

  if (scheduleQ.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading pairings" />
      </View>
    );
  }

  // C17: offline or a failed load isn't the same as a round that went out.
  if (!round && (scheduleQ.isError || !scheduleQ.data)) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space4 }}>
        <ProblemCard
          title="Can't load these pairings"
          body="Check your connection and try again."
          onRetry={() => void scheduleQ.refetch()}
          retrying={scheduleQ.isRefetching}
        />
      </View>
    );
  }

  if (!round || round.phase !== "draft") {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space4 }}>
        <Card style={{ gap: spacing.space2 }}>
          <Text variant="bodyStrong">This round has gone out to players</Text>
          <Text tone="inkMuted">See it on the league's Matches tab.</Text>
        </Card>
      </View>
    );
  }

  const label = (id: number, name: string) => {
    const r = rating(id);
    return r ? `${name} (${r})` : name;
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      {sheet.element}
      <Stack.Screen
        options={{
          headerRight: () => (
            <TextButton label="Re-pair" onPress={confirmRepair} disabled={busy} accessibilityHint="New pairings. Keeps locked matches and byes you set" />
          ),
        }}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: spacing.space8, gap: spacing.space2 }}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink} />}
      >
        <View style={{ gap: spacing.space1, marginBottom: spacing.space2 }}>
          <Text variant="headingM" accessibilityRole="header">
            {`Round ${round.roundNumber} pairings`}
          </Text>
          <Text variant="small" tone="inkMuted">
            {`${dateRange(round.startDate, round.deadline)}. Only admins see these until they go out ${shortDate(round.startDate)} at ${pairingTime(scheduleQ.data?.timeZone)}. ${
              doubles ? "Tap a match to lock it, or re-pair. Change fixed teams in Manage, Teams." : "Tap a match to swap players, give a bye, or lock it."
            }`}
          </Text>
        </View>
        <OfflineNotice pull={pull} style={{ marginBottom: spacing.space2 }} />

        <Heading>{`Matches (${round.matches.length})`}</Heading>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {round.matches.length === 0 ? (
            <ListRow title="No matches yet" subtitle="Re-pair to pair everyone." last />
          ) : (
            round.matches.map((m, i) => (
              <ListRow
                key={m.matchId}
                title={doubles ? `${sideLabels(m).side1} vs. ${sideLabels(m).side2}` : `${m.player1Name} vs. ${m.player2Name}`}
                subtitle={
                  doubles
                    ? null
                    : [label(m.player1Id, m.player1Name), label(m.player2Id, m.player2Name)].join(" · ")
                }
                trailing={m.locked ? "Locked" : null}
                symbol={m.locked ? "lock.fill" : undefined}
                onPress={() => matchMenu(round, m)}
                accessibilityHint={m.locked ? "Unlock this match" : doubles ? "Lock this match" : "Swap a player, give a bye, or lock this match"}
                last={i === round.matches.length - 1}
              />
            ))
          )}
        </Card>

        {round.byes.length > 0 ? (
          <>
            <Heading>Byes</Heading>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {round.byes.map((b, i) => (
                <ListRow
                  key={b.playerId}
                  title={`Bye: ${b.playerName}`}
                  subtitle={b.setByAdmin ? "Set by an admin. Stays when you re-pair." : "Fewest byes so far this season."}
                  onPress={doubles ? undefined : () => byeMenu(round, { playerId: b.playerId, name: b.playerName })}
                  accessibilityHint={doubles ? undefined : "Take away the bye or swap"}
                  last={i === round.byes.length - 1}
                />
              ))}
            </Card>
          </>
        ) : null}

        {round.unpaired.length > 0 ? (
          <>
            <Heading>{doubles ? "Not in a match yet" : "Needs an opponent"}</Heading>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {round.unpaired.map((u, i) => (
                <ListRow
                  key={u.playerId}
                  title={u.playerName}
                  subtitle="Paired automatically when the round goes out."
                  onPress={doubles ? undefined : () => unpairedMenu(round, { playerId: u.playerId, name: u.playerName })}
                  accessibilityHint={doubles ? undefined : "Give a bye or swap"}
                  last={i === round.unpaired.length - 1}
                />
              ))}
            </Card>
          </>
        ) : null}
      </ScrollView>

      {/* The primary action, pinned at the bottom (approved canvas). */}
      <View
        style={{
          paddingHorizontal: spacing.space4,
          paddingTop: spacing.space3,
          paddingBottom: insets.bottom + spacing.space3,
          gap: spacing.space2,
          borderTopWidth: 1,
          borderTopColor: c.hairline,
          backgroundColor: c.paper,
        }}
      >
        <Button label={`Send Round ${round.roundNumber} to players`} loading={busy && publish.isPending} disabled={busy} onPress={() => confirmPublish(round)} />
        <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
          {doubles ? "Players get a notification with their partner and opponents." : "Players get a notification with their opponent."}
        </Text>
      </View>
    </View>
  );
}
