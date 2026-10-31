import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { AccessibilityInfo, ActionSheetIOS, ActivityIndicator, Alert, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
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

import { ListRow, SectionLabel } from "@/components/league/ListRow";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { dateRange, shortDate } from "@/lib/leagueSchedule";

// Review a round before it goes out (spec: Leagues > Weekly loop, step 2;
// canvas: Schedule review). Tap any row for its actions: swap a player, give
// a bye, lock the match. Action sheets, not gestures, so every action works
// with VoiceOver and Switch Control.

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
    const a = { playerId: m.player1Id, name: m.player1Name };
    const b = { playerId: m.player2Id, name: m.player2Name };
    const actions: { label: string; go: () => void }[] = m.locked
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

  if (!round || round.phase !== "draft") {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space4 }}>
        <Card style={{ gap: spacing.space2 }}>
          <Text variant="bodyStrong">This round has gone out to players</Text>
          <Text tone="inkMuted">See it on the league's Rounds tab.</Text>
        </Card>
      </View>
    );
  }

  const label = (id: number, name: string) => {
    const r = rating(id);
    return r ? `${name} (${r})` : name;
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space2 }}
      refreshControl={<RefreshControl refreshing={scheduleQ.isRefetching} onRefresh={() => void scheduleQ.refetch()} tintColor={c.ink} />}
    >
      <View style={{ gap: spacing.space1, marginBottom: spacing.space2 }}>
        <Text variant="label" tone="inkMuted">
          {`Round ${round.roundNumber} · ${dateRange(round.startDate, round.deadline)}`}
        </Text>
        <Text variant="displayL" accessibilityRole="header">
          Pairings
        </Text>
        <Text tone="inkMuted">
          {`Only admins can see these until they go out ${shortDate(round.startDate)} at 7am. Tap a match to swap players, give a bye, or lock it.`}
        </Text>
      </View>

      <SectionLabel>{`Matches (${round.matches.length})`}</SectionLabel>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {round.matches.length === 0 ? (
          <ListRow title="No matches yet" subtitle="Re-pair to pair everyone." last />
        ) : (
          round.matches.map((m, i) => (
            <ListRow
              key={m.matchId}
              title={`${m.player1Name} vs. ${m.player2Name}`}
              subtitle={[label(m.player1Id, m.player1Name), label(m.player2Id, m.player2Name)].join(" · ")}
              trailing={m.locked ? "Locked" : null}
              symbol={m.locked ? "lock.fill" : undefined}
              onPress={() => matchMenu(round, m)}
              accessibilityHint={m.locked ? "Unlock this match" : "Swap a player, give a bye, or lock this match"}
              last={i === round.matches.length - 1}
            />
          ))
        )}
      </Card>

      {round.byes.length > 0 ? (
        <>
          <SectionLabel>Byes</SectionLabel>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {round.byes.map((b, i) => (
              <ListRow
                key={b.playerId}
                title={`Bye: ${b.playerName}`}
                subtitle={b.setByAdmin ? "Set by an admin. Stays when you re-pair." : "Fewest byes so far this season."}
                onPress={() => byeMenu(round, { playerId: b.playerId, name: b.playerName })}
                accessibilityHint="Take away the bye or swap"
                last={i === round.byes.length - 1}
              />
            ))}
          </Card>
        </>
      ) : null}

      {round.unpaired.length > 0 ? (
        <>
          <SectionLabel>Needs an opponent</SectionLabel>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {round.unpaired.map((u, i) => (
              <ListRow
                key={u.playerId}
                title={u.playerName}
                subtitle="Paired automatically when the round goes out."
                onPress={() => unpairedMenu(round, { playerId: u.playerId, name: u.playerName })}
                accessibilityHint="Give a bye or swap"
                last={i === round.unpaired.length - 1}
              />
            ))}
          </Card>
        </>
      ) : null}

      <View style={{ gap: spacing.space3, marginTop: spacing.space4 }}>
        <Button label={`Send Round ${round.roundNumber} to players`} loading={busy && publish.isPending} disabled={busy} onPress={() => confirmPublish(round)} />
        <Button label="Re-pair" variant="secondary" disabled={busy} onPress={confirmRepair} accessibilityHint="Keeps locked matches and byes you set" />
      </View>
    </ScrollView>
  );
}
