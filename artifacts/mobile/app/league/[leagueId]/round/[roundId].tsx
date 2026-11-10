import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { AccessibilityInfo, ActionSheetIOS, ActivityIndicator, Alert, RefreshControl, ScrollView, View } from "react-native";
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

import { ListRow } from "@/components/league/ListRow";
import { Button, Card, Text, TextButton } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { dateRange, pairingTime, shortDate, sideLabels } from "@/lib/leagueSchedule";

// Review a round before it goes out (spec: Leagues > Weekly loop, step 2;
// approved canvas: Admin · Schedule review). A brush title, the matches as
// rows, Re-pair at the top right and Send at the bottom. Tap any row for its
// actions: swap a player, give a bye, lock the match. Action sheets, not
// gestures, so every action works with VoiceOver and Switch Control.

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
  const [busy, setBusy] = useState(false);

  const swap = useSwapLeagueRoundPlayers();
  const addBye = useAddLeagueRoundBye();
  const removeBye = useRemoveLeagueRoundBye();
  const lock = useLockLeagueRoundMatch();
  const repair = useRepairLeagueRound();
  const publish = usePublishLeagueRound();

  const round = scheduleQ.data?.rounds.find((r) => r.roundId === roundId);
  const rating = (id: number) => rosterQ.data?.find((p) => p.playerId === id)?.skillLevel;

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

  function swapWith(r: ScheduleRound, p: Person) {
    const others = everyone(r).filter((o) => o.playerId !== p.playerId);
    const options = [...others.map((o) => o.name), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: `Swap ${p.name} with`, options, cancelButtonIndex: options.length - 1 },
      (i) => {
        const other = others[i];
        if (!other) return;
        void run(
          () => swap.mutateAsync({ leagueId, roundId, data: { playerAId: p.playerId, playerBId: other.playerId } }),
          `Swapped ${p.name} and ${other.name}`,
        );
      },
    );
  }

  function giveBye(p: Person) {
    void run(() => addBye.mutateAsync({ leagueId, roundId, data: { playerId: p.playerId } }), `${p.name} has a bye`);
  }

  function matchMenu(r: ScheduleRound, m: ScheduleMatch) {
    const a = { playerId: m.player1Id, name: doubles ? sideLabels(m).side1 : m.player1Name };
    const b = { playerId: m.player2Id, name: doubles ? sideLabels(m).side2 : m.player2Name };
    const lockOnly = [
      {
        label: m.locked ? "Unlock match" : "Lock match",
        go: () =>
          void run(() => lock.mutateAsync({ leagueId, roundId, matchId: m.matchId, data: { locked: !m.locked } }), m.locked ? "Match unlocked" : "Match locked"),
      },
    ];
    const actions: { label: string; go: () => void }[] = doubles
      ? lockOnly
      : m.locked
      ? [
          {
            label: "Unlock match",
            go: () => void run(() => lock.mutateAsync({ leagueId, roundId, matchId: m.matchId, data: { locked: false } }), "Match unlocked"),
          },
        ]
      : [
          { label: `Swap ${a.name} with…`, go: () => swapWith(r, a) },
          { label: `Swap ${b.name} with…`, go: () => swapWith(r, b) },
          { label: `Give ${a.name} a bye`, go: () => giveBye(a) },
          { label: `Give ${b.name} a bye`, go: () => giveBye(b) },
          {
            label: "Lock match",
            go: () => void run(() => lock.mutateAsync({ leagueId, roundId, matchId: m.matchId, data: { locked: true } }), "Match locked"),
          },
        ];
    const options = [...actions.map((x) => x.label), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `${a.name} vs. ${b.name}`,
        message: m.locked ? "Locked matches stay as they are when you re-pair." : undefined,
        options,
        cancelButtonIndex: options.length - 1,
      },
      (i) => actions[i]?.go(),
    );
  }

  function byeMenu(r: ScheduleRound, p: Person) {
    const actions = [
      {
        label: `Take away ${p.name}'s bye`,
        go: () => void run(() => removeBye.mutateAsync({ leagueId, roundId, playerId: p.playerId }), `${p.name} needs an opponent`),
      },
      { label: `Swap ${p.name} with…`, go: () => swapWith(r, p) },
    ];
    const options = [...actions.map((x) => x.label), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions({ title: `Bye: ${p.name}`, options, cancelButtonIndex: options.length - 1 }, (i) =>
      actions[i]?.go(),
    );
  }

  function unpairedMenu(r: ScheduleRound, p: Person) {
    const actions = [
      { label: `Give ${p.name} a bye`, go: () => giveBye(p) },
      { label: `Swap ${p.name} with…`, go: () => swapWith(r, p) },
    ];
    const options = [...actions.map((x) => x.label), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions({ title: p.name, options, cancelButtonIndex: options.length - 1 }, (i) =>
      actions[i]?.go(),
    );
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
        <Card style={{ gap: spacing.space3 }}>
          <Text variant="bodyStrong">Couldn't load</Text>
          <Text tone="inkMuted">Check your connection and try again.</Text>
          <Button label="Retry" variant="secondary" loading={scheduleQ.isRefetching} onPress={() => void scheduleQ.refetch()} />
        </Card>
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
        refreshControl={<RefreshControl refreshing={scheduleQ.isRefetching} onRefresh={() => void scheduleQ.refetch()} tintColor={c.ink} />}
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
