import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";

import { DoublesMatchCard } from "@/components/record/DoublesMatchCard";
import { LocalProcessingCard, ServerProcessingCard } from "@/components/record/ProcessingCard";
import { TodaysMatchCard } from "@/components/record/TodaysMatchCard";
import { TabScreen } from "@/components/TabHeader";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useServerRecordings, useTodaysMatches } from "@/lib/recording/api";
import { takePendingInvite } from "@/lib/recording/pendingInvite";
import { useQueue } from "@/lib/recording/queue";
import { openRecorder } from "@/lib/recording/start";

// Ball Boi tab (spec: Navigation, Ball Boi > Recording).
// "Record a match" lists today's matches first. Every recording starts from a match.
export default function BallBoiScreen() {
  const c = useColors();
  const router = useRouter();
  const today = useTodaysMatches();
  const matches = today.data ?? [];
  const queued = useQueue();
  const server = useServerRecordings();
  // A recording mid-upload can be in both lists; the phone's copy wins.
  const onPhone = new Set(queued.map((r) => r.sessionId).filter((id) => id != null));
  const onServer = (server.data ?? []).filter((r) => !onPhone.has(r.sessionId));
  const refreshing = today.isRefetching || server.isRefetching;

  // An invite link opened before signing in opens now.
  useEffect(() => {
    takePendingInvite().then((code) => {
      if (code) router.push({ pathname: "/record/invite/[code]", params: { code } });
    });
  }, [router]);
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
          <Text variant="label" accessibilityRole="header">
            Record a match
          </Text>

          {today.isLoading ? (
            <ActivityIndicator color={c.ink} accessibilityLabel="Loading today's matches" />
          ) : today.isError ? (
            <Card style={{ gap: spacing.space3 }}>
              <Text>Couldn't load today's matches.</Text>
              <Button variant="secondary" label="Try again" onPress={() => today.refetch()} />
            </Card>
          ) : matches.length === 0 ? (
            <Text tone="inkMuted">No matches on your schedule today.</Text>
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

        {queued.length > 0 || onServer.length > 0 ? (
          <View style={{ gap: spacing.space3 }}>
            <Text variant="label" accessibilityRole="header">
              Your recordings
            </Text>
            {[...queued].reverse().map((r) => (
              <LocalProcessingCard key={r.id} rec={r} />
            ))}
            {onServer.map((r) => (
              <ServerProcessingCard key={r.sessionId} rec={r} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </TabScreen>
  );
}
