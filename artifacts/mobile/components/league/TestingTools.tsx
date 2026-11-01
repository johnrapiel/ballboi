import { router } from "expo-router";
import React from "react";
import { AccessibilityInfo, Alert, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetDevLeagueToolsQueryKey,
  useDevPairLeagueNow,
  useGetDevLeagueTools,
  useMoveDevLeagueTime,
  type DevTimeBodyAction,
} from "@workspace/api-client-react";

import { ListRow, SectionLabel } from "@/components/league/ListRow";
import { Card, Text } from "@/components/ui";
import { shortDate } from "@/lib/leagueSchedule";

// Testing tools (development builds only), for walkthroughs: jump this league
// forward in time and run Flex pairing now. The API refuses all of it in
// production, and this section never renders outside a development build.

function errorText(e: unknown): string {
  const data = (e as { data?: { error?: string; message?: string } | null }).data;
  return data?.message ?? data?.error ?? "Try again in a moment.";
}

export function TestingTools({ leagueId, onChanged }: { leagueId: number; onChanged: () => Promise<unknown> }) {
  const queryClient = useQueryClient();
  // Only asked in development builds; a 404 (production API) hides the section.
  const toolsQ = useGetDevLeagueTools(leagueId, { query: { enabled: __DEV__, retry: false, queryKey: getGetDevLeagueToolsQueryKey(leagueId) } });
  const move = useMoveDevLeagueTime();
  const pair = useDevPairLeagueNow();

  if (!__DEV__ || !toolsQ.data?.available) return null;
  const tools = toolsQ.data;
  const round = tools.targetRound ? `Round ${tools.targetRound.roundNumber}` : "This round";

  async function done(message: string) {
    await Promise.all([onChanged(), queryClient.invalidateQueries({ queryKey: getGetDevLeagueToolsQueryKey(leagueId) })]);
    AccessibilityInfo.announceForAccessibility(message);
    Alert.alert("Done", message);
  }

  function jump(action: DevTimeBodyAction, title: string, detail: string) {
    Alert.alert(title, `${detail}\n\nThis moves the league's dates. It doesn't pair or send rounds.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Move",
        onPress: () =>
          move
            .mutateAsync({ leagueId, data: { action } })
            .then((r) => done(r.message))
            .catch((e) => Alert.alert("Not changed", errorText(e))),
      },
    ]);
  }

  function pairNow() {
    pair
      .mutateAsync({ leagueId })
      .then(async (r) => {
        await onChanged();
        if (r.roundId) router.push(`/league/${leagueId}/round/${r.roundId}`);
        else Alert.alert("Done", r.message);
      })
      .catch((e) => Alert.alert("Not paired", errorText(e)));
  }

  const rows = [
    {
      title: "Start the season today",
      subtitle: tools.seasonStarted ? "Already started" : `Starts ${tools.startDate ? shortDate(tools.startDate) : "later"} now`,
      onPress: () => jump("season_started", "Start the season today?", "New players will go to the waitlist."),
    },
    {
      title: "Run Flex pairing now",
      subtitle: "Drafts the next round for you to review and send",
      onPress: pairNow,
    },
    {
      title: "Pass the round's deadline",
      subtitle: `${round}'s deadline becomes yesterday: grace week, day 1`,
      onPress: () => jump("deadline_passed", "Pass the deadline?", `${round}'s deadline becomes yesterday. Scores then count for Ball Boi stats, not standings.`),
    },
    {
      title: "Middle of the grace week",
      subtitle: `${round}'s grace week, day 4`,
      onPress: () => jump("in_grace", "Move to mid-grace week?", `${round} moves to day 4 of its grace week.`),
    },
    {
      title: "End the grace week",
      subtitle: `${round}'s matches can't be scored after this`,
      onPress: () => jump("grace_over", "End the grace week?", `${round}'s grace week ends yesterday, so its unplayed matches can't be scored.`),
    },
  ];

  return (
    <View>
      <SectionLabel>Testing tools</SectionLabel>
      <Text variant="small" tone="inkMuted">
        {`Development builds only. Today is ${shortDate(tools.today)} for this league.`}
      </Text>
      <Card style={{ padding: 0, overflow: "hidden", marginTop: 8 }}>
        {rows.map((r, i) => (
          <ListRow key={r.title} title={r.title} subtitle={r.subtitle} symbol="clock" onPress={r.onPress} last={i === rows.length - 1} />
        ))}
      </Card>
    </View>
  );
}
