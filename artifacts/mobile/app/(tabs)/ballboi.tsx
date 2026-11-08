import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";

import { DoublesMatchCard } from "@/components/record/DoublesMatchCard";
import { LocalProcessingCard, ServerProcessingCard } from "@/components/record/ProcessingCard";
import { TodaysMatchCard } from "@/components/record/TodaysMatchCard";
import { TabScreen } from "@/components/TabHeader";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { useServerRecordings, useTodaysMatches } from "@/lib/recording/api";
import { useQueue, useQueueLoaded } from "@/lib/recording/queue";
import { openRecorder } from "@/lib/recording/start";

// Ball Boi tab (spec: Navigation, Ball Boi > Recording).
// "Record a match" lists your unplayed matches this week, with a match set for
// today first, then Quick match. Every recording starts from a match.
export default function BallBoiScreen() {
  const c = useColors();
  const router = useRouter();
  const today = useTodaysMatches();
  const queued = useQueue();
  const queueLoaded = useQueueLoaded();
  // A Quick match already recorded on this phone isn't one to record any more (D6, Q18).
  const recordedHere = new Set(queued.map((r) => r.matchId));
  const matches = (today.data ?? []).filter((m) => m.leagueId != null || !recordedHere.has(m.id));
  const server = useServerRecordings();
  // A recording mid-upload can be in both lists; the phone's copy wins.
  const onPhone = new Set(queued.map((r) => r.sessionId).filter((id) => id != null));
  const onServer = (server.data ?? []).filter((r) => !onPhone.has(r.sessionId));
  // Still waiting for its video, recorded by you, and not on this phone: it
  // can't upload any more, as after a reinstall (D18).
  const lost = (r: (typeof onServer)[number]) => queueLoaded && r.recordedByYou && r.stage === "uploading";
  const refreshing = today.isRefetching || server.isRefetching;

  const refresh = () => {
    today.refetch();
    server.refetch();
  };

  return (
    <TabScreen title="Ball Boi">
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.space4, paddingBottom: spacing.space12, gap: spacing.space6 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.ink} />
        }
      >
        <View style={{ gap: spacing.space3 }}>
          <Text variant="section" tone="inkMuted" accessibilityRole="header">
            Record a match
          </Text>

          {today.isLoading ? (
            <ActivityIndicator color={c.ink} accessibilityLabel="Loading your matches" />
          ) : today.isError ? (
            <Card style={{ gap: spacing.space3 }}>
              <Text accessibilityRole="alert">
                {isOfflineError(today.error) ? OFFLINE_MESSAGE : "Couldn't load your matches."}
              </Text>
              <Button variant="secondary" label="Try again" onPress={() => today.refetch()} />
            </Card>
          ) : matches.length === 0 ? (
            <Text tone="inkMuted">No matches to record this week.</Text>
          ) : (
            matches.map((m) =>
              m.format === "doubles" ? (
                <DoublesMatchCard key={m.id} match={m} />
              ) : (
                <TodaysMatchCard
                  key={m.id}
                  match={m}
                  onRecord={() => openRecorder(router, { matchId: m.id, opponentName: m.opponentName, leagueId: m.leagueId })}
                />
              ),
            )
          )}

          <Card style={{ gap: spacing.space3 }}>
            <View accessible style={{ gap: spacing.space1 }}>
              <Text variant="bodyStrong">Quick match</Text>
              <Text variant="small" tone="inkMuted">
                A casual hit, or a match outside your leagues. Play anyone, even if they're not on Ball Boi yet.
              </Text>
            </View>
            <Button variant="secondary" label="Quick match" onPress={() => router.push("/record/quick")} />
          </Card>
        </View>

        {queued.length > 0 || onServer.length > 0 || server.isError ? (
          <View style={{ gap: spacing.space3 }}>
            <Text variant="section" tone="inkMuted" accessibilityRole="header">
              Your recordings
            </Text>
            {[...queued].reverse().map((r) => (
              <LocalProcessingCard key={r.id} rec={r} />
            ))}
            {server.isError ? (
              // D32: never fail quietly.
              <Card style={{ gap: spacing.space3 }}>
                <Text accessibilityRole="alert">
                  {isOfflineError(server.error) ? OFFLINE_MESSAGE : "Couldn't load your recordings."}
                </Text>
                <Button
                  variant="secondary"
                  label="Try again"
                  loading={server.isRefetching}
                  onPress={() => server.refetch()}
                />
              </Card>
            ) : (
              onServer.map((r) => <ServerProcessingCard key={r.sessionId} rec={r} lost={lost(r)} />)
            )}
          </View>
        ) : null}
      </ScrollView>
    </TabScreen>
  );
}
