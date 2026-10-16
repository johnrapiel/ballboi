import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { useGetLeagues, type League } from "@workspace/api-client-react";
import { Card, EmptyState, Loading, Text } from "@/components/ui";
import { MIN_TAP, space, useTheme } from "@/theme";

function LeagueRow({ league }: { league: League }) {
  const { c } = useTheme();
  const summary = `${league.playerCount} players, ${league.matchCount} matches`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${league.name}. ${league.status}. ${summary}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, minHeight: MIN_TAP })}
    >
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
          <Text variant="headline" style={{ flexShrink: 1 }}>{league.name}</Text>
          <Text variant="label" color={league.status === "active" ? c.success : c.textMuted}>
            {league.status.toUpperCase()}
          </Text>
        </View>
        {league.location ? <Text muted>{league.location}</Text> : null}
        <Text variant="footnote" muted>{summary}</Text>
      </Card>
    </Pressable>
  );
}

export default function LeaguesScreen() {
  const { c } = useTheme();
  const leagues = useGetLeagues();

  if (leagues.isLoading) return <Loading label="Loading leagues" />;

  return (
    <FlatList
      style={{ backgroundColor: c.background }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      contentInsetAdjustmentBehavior="automatic"
      data={leagues.data ?? []}
      keyExtractor={(l) => String(l.id)}
      renderItem={({ item }) => <LeagueRow league={item} />}
      refreshControl={<RefreshControl refreshing={leagues.isRefetching} onRefresh={() => leagues.refetch()} tintColor={c.primary} />}
      ListEmptyComponent={<EmptyState title="No leagues yet" body="Ask your league organizer for an invite link, or start your own league." />}
    />
  );
}
