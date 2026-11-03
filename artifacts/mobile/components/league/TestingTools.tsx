import { router } from "expo-router";
import React, { useState } from "react";
import { Alert, View } from "react-native";
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
import { spacing } from "@/constants/tokens";
import { addDays, shortDate } from "@/lib/leagueSchedule";

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
  // One action at a time: a second tap while one runs does nothing.
  const [busy, setBusy] = useState<string | null>(null);

  if (!__DEV__ || !toolsQ.data?.available) return null;
  const tools = toolsQ.data;
  const target = tools.targetRound;
  const round = target ? `Round ${target.roundNumber}` : null;

  async function run(key: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    try {
      await task();
    } finally {
      setBusy(null);
    }
  }

  function jump(key: string, action: DevTimeBodyAction, title: string, detail: string, confirm: string) {
    Alert.alert(title, `${detail}\n\nThis moves the league's dates. It doesn't pair or send rounds.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: confirm,
        onPress: () =>
          void run(key, async () => {
            try {
              const r = await move.mutateAsync({ leagueId, data: { action } });
              await Promise.all([onChanged(), queryClient.invalidateQueries({ queryKey: getGetDevLeagueToolsQueryKey(leagueId) })]);
              Alert.alert("Done", r.message);
            } catch (e) {
              Alert.alert("Not changed", errorText(e));
            }
          }),
      },
    ]);
  }

  function pairNow() {
    void run("pair", async () => {
      try {
        const r = await pair.mutateAsync({ leagueId });
        await onChanged();
        if (r.roundId) router.push(`/league/${leagueId}/round/${r.roundId}`);
        else Alert.alert("Done", r.message);
      } catch (e) {
        Alert.alert("Not paired", errorText(e));
      }
    });
  }

  // Grace-week jumps only move time forward. Each one is offered only while
  // the round's deadline is still later than where the jump would put it.
  const until = (daysAgo: number) => !!target && target.deadline > addDays(tools.today, -daysAgo);
  const noRound = "Send a round to players first";

  type Row = { key: string; title: string; subtitle: string; symbol: "calendar" | "person.2" | "clock"; onPress: (() => void) | null; unavailable?: string };
  const rows: Row[] = [
    {
      key: "season",
      title: "Start the season today",
      subtitle: tools.seasonStarted
        ? `Started ${tools.startDate ? shortDate(tools.startDate) : ""}`.trim()
        : `Scheduled for ${tools.startDate ? shortDate(tools.startDate) : "later"}. New players go to the waitlist after.`,
      symbol: "calendar",
      onPress: tools.seasonStarted
        ? null
        : () => jump("season", "season_started", "Start the season today?", "New players will go to the waitlist.", "Start season"),
      unavailable: tools.seasonStarted ? "Started" : undefined,
    },
    {
      key: "pair",
      title: "Run Flex pairing now",
      subtitle: "Drafts the next round for you to review and send",
      symbol: "person.2",
      onPress: pairNow,
    },
    {
      key: "deadline",
      title: "Pass the round's deadline",
      subtitle: round ? `${round}'s deadline becomes yesterday: grace week, day 1` : noRound,
      symbol: "clock",
      onPress: until(1)
        ? () =>
            jump("deadline", "deadline_passed", "Pass the deadline?", `${round}'s deadline becomes yesterday. Scores then count for Ball Boi stats, not standings.`, "Pass deadline")
        : null,
      unavailable: !round ? "Not yet" : until(1) ? undefined : "Passed",
    },
    {
      key: "grace",
      title: "Middle of the grace week",
      subtitle: round ? `${round}'s grace week, day 4` : noRound,
      symbol: "clock",
      onPress: until(4) ? () => jump("grace", "in_grace", "Move to mid-grace week?", `${round} moves to day 4 of its grace week.`, "Move to day 4") : null,
      unavailable: !round ? "Not yet" : until(4) ? undefined : "Passed",
    },
    {
      key: "over",
      title: "End the grace week",
      subtitle: round ? `${round}'s unplayed matches can't be scored after this` : noRound,
      symbol: "clock",
      onPress: until(8)
        ? () => jump("over", "grace_over", "End the grace week?", `${round}'s grace week ends yesterday, so its unplayed matches can't be scored.`, "End grace week")
        : null,
      unavailable: !round ? "Not yet" : until(8) ? undefined : "Passed",
    },
  ];

  return (
    <View style={{ gap: spacing.space2 }}>
      <SectionLabel>Testing tools</SectionLabel>
      <Text variant="small" tone="inkMuted">
        {`Development builds only. Today is ${shortDate(tools.today)} for this league.`}
      </Text>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {rows.map((r, i) => (
          <ListRow
            key={r.key}
            title={r.title}
            subtitle={r.subtitle}
            symbol={r.symbol}
            trailing={busy === r.key ? "Working" : r.unavailable ?? null}
            onPress={busy || !r.onPress ? undefined : r.onPress}
            last={i === rows.length - 1}
          />
        ))}
      </Card>
    </View>
  );
}
