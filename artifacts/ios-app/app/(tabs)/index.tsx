import { RefreshControl, ScrollView, View } from "react-native";
import { useGetDashboardStats, useGetMySchedule } from "@workspace/api-client-react";
import { Card, EmptyState, Loading, StatTile, Text } from "@/components/ui";
import { space, useTheme } from "@/theme";

function formatWhen(iso?: string | null) {
  if (!iso) return "Time not set yet";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function HomeScreen() {
  const { c } = useTheme();
  const stats = useGetDashboardStats();
  const schedule = useGetMySchedule();
  const next = schedule.data?.match ?? null;

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          refreshing={stats.isRefetching || schedule.isRefetching}
          onRefresh={() => { stats.refetch(); schedule.refetch(); }}
          tintColor={c.primary}
        />
      }
    >
      <Text variant="title" accessibilityRole="header">Your next match</Text>
      {schedule.isLoading ? (
        <Loading label="Loading your schedule" />
      ) : next ? (
        <Card>
          <Text variant="label" muted>VS</Text>
          <Text variant="headline">{next.opponentName}</Text>
          <Text muted>{formatWhen(next.scheduledAt)}</Text>
        </Card>
      ) : (
        <EmptyState title="No match scheduled" body="Join a league or set your availability to get matched." />
      )}

      <Text variant="title" accessibilityRole="header">This season</Text>
      {stats.isLoading ? (
        <Loading label="Loading stats" />
      ) : stats.data ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
          <StatTile label="Active leagues" value={stats.data.activeLeagues} />
          <StatTile label="Matches played" value={stats.data.completedMatches} />
          <StatTile label="This week" value={stats.data.matchesThisWeek} />
          <StatTile label="Scheduled" value={stats.data.scheduledMatches} />
        </View>
      ) : (
        <EmptyState title="Stats unavailable" body="Pull down to try again." />
      )}
    </ScrollView>
  );
}
