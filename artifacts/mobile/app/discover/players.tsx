import { useGetDiscoverPlayers } from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlayerRow } from "@/components/discover/PlayerRow";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useDiscoverFilters } from "@/hooks/useDiscoverFilters";
import { filterChips } from "@/lib/discover";

// Players near you, all of them (See all on Discover), with the same filters.

export default function DiscoverPlayersScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const filters = useDiscoverFilters();
  const query = useGetDiscoverPlayers(filters);
  const players = query.data?.players ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      {query.isPending ? (
        <ActivityIndicator style={{ marginTop: spacing.space12 }} color={c.ink} accessibilityLabel="Loading players near you" />
      ) : query.isError && !query.data ? (
        <View style={{ padding: spacing.space6, gap: spacing.space4, alignItems: "center" }}>
          <Text tone="inkMuted" style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
            Players didn't load. Check your connection and try again.
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => void query.refetch()} />
        </View>
      ) : (
        <FlatList
          data={players}
          keyExtractor={(p) => String(p.userId)}
          renderItem={({ item }) => (
            <PlayerRow
              player={item}
              onPress={() => router.push({ pathname: "/discover/player/[userId]", params: { userId: String(item.userId) } })}
            />
          )}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.ink} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.space6 }}
          ListHeaderComponent={
            <Text variant="small" tone="inkMuted" style={{ paddingHorizontal: spacing.space4, paddingVertical: spacing.space3 }}>
              {`${players.length} ${players.length === 1 ? "player" : "players"} · ${filterChips(filters, query.data?.myRating).join(" · ")}`}
            </Text>
          }
        />
      )}
    </View>
  );
}
