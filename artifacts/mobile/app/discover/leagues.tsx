import { useGetDiscoverLeagues } from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LeagueCard } from "@/components/discover/LeagueCard";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useDiscoverFilters } from "@/hooks/useDiscoverFilters";

// Open leagues, all of them (See all on Discover), within the same radius.

export default function DiscoverLeaguesScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { radius } = useDiscoverFilters();
  const query = useGetDiscoverLeagues({ radius });
  const leagues = query.data?.leagues ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      {query.isPending ? (
        <ActivityIndicator style={{ marginTop: spacing.space12 }} color={c.ink} accessibilityLabel="Loading Open leagues" />
      ) : query.isError && !query.data ? (
        <View style={{ padding: spacing.space6, gap: spacing.space4, alignItems: "center" }}>
          <Text tone="inkMuted" style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
            Open leagues didn't load. Check your connection and try again.
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => void query.refetch()} />
        </View>
      ) : (
        <FlatList
          data={leagues}
          keyExtractor={(l) => String(l.leagueId)}
          renderItem={({ item }) => (
            <LeagueCard
              league={item}
              onPress={() => router.push({ pathname: "/discover/league/[leagueId]", params: { leagueId: String(item.leagueId) } })}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing.space3 }} />}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.ink} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.space6 }}
          ListHeaderComponent={
            <Text variant="small" tone="inkMuted" style={{ paddingHorizontal: spacing.space4, paddingVertical: spacing.space3 }}>
              {`${leagues.length} Open ${leagues.length === 1 ? "league" : "leagues"} within ${radius} mi`}
            </Text>
          }
        />
      )}
    </View>
  );
}
