import { useGetDiscoverPlayers } from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, View } from "react-native";

import { LinkButton } from "@/components/discover/LinkButton";
import { PlayerRow } from "@/components/discover/PlayerRow";
import { EmptyState } from "@/components/EmptyState";
import { TabScreen } from "@/components/TabHeader";
import { Button, Card, Chip, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { setDiscoverFilters, useDiscoverFilters } from "@/hooks/useDiscoverFilters";
import { filterChips, INVITE_MESSAGE, widerRadius } from "@/lib/discover";

// Discover (spec: Discover; canvas: Discover). Always local: players within
// the chosen radius of your home area, nearest and closest in level first,
// with approximate distance only. Open leagues, Open matches, the court
// directory and travel mode come in the next Wave 2 PRs.

/** Players near you shown on Discover itself; See all opens the full list. */
const PREVIEW = 5;

export default function DiscoverScreen() {
  const c = useColors();
  const router = useRouter();
  const filters = useDiscoverFilters();
  const query = useGetDiscoverPlayers(filters);
  const data = query.data;
  const chips = filterChips(filters, data?.myRating);
  const wider = data ? widerRadius(data.counts, filters.radius) : null;

  const invite = () => {
    void Share.share({ message: INVITE_MESSAGE });
  };

  return (
    <TabScreen title="Discover">
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.space8, gap: spacing.space4 }}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.ink} />}
      >
        <Pressable
          onPress={() => router.push("/discover/filters")}
          accessibilityRole="button"
          accessibilityLabel={`Filters: ${chips.join(", ")}`}
          accessibilityHint="Change distance, level, singles or doubles, and when they're free"
          style={({ pressed }) => ({
            minHeight: MIN_TAP,
            marginHorizontal: spacing.space4,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: spacing.space2,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View
            style={{
              minHeight: 32,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.space1,
              paddingHorizontal: spacing.space3,
              borderRadius: radius.radiusPill,
              backgroundColor: c.ink,
            }}
          >
            <SymbolView name="line.3.horizontal.decrease" size={14} tintColor={c.onInk} />
            <Text variant="chip" tone="onInk">
              Filters
            </Text>
          </View>
          {chips.map((label) => (
            <Chip key={label} label={label} />
          ))}
        </Pressable>

        {query.isPending ? (
          <ActivityIndicator style={{ marginTop: spacing.space12 }} color={c.ink} accessibilityLabel="Loading Discover" />
        ) : query.isError && !data ? (
          <View style={{ padding: spacing.space6, gap: spacing.space4, alignItems: "center" }}>
            <Text tone="inkMuted" style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
              Discover didn't load. Check your connection and try again.
            </Text>
            <Button label="Try again" variant="secondary" onPress={() => void query.refetch()} />
          </View>
        ) : data?.homeAreaProblem ? (
          <Card style={{ marginHorizontal: spacing.space4, gap: spacing.space3 }}>
            <Text variant="bodyStrong" accessibilityRole="header">
              Set your home area
            </Text>
            <Text tone="inkMuted">{data.homeAreaProblem}</Text>
            <Button label="Edit home area" variant="secondary" onPress={() => router.push("/profile/edit/home")} />
          </Card>
        ) : data ? (
          <>
            {data.hidden ? (
              <Card style={{ marginHorizontal: spacing.space4, gap: spacing.space2, flexDirection: "row", alignItems: "flex-start" }}>
                <SymbolView name="eye.slash" size={18} tintColor={c.ink} />
                <View style={{ flex: 1, gap: spacing.space1 }}>
                  <Text>Your profile is hidden, so players near you can't find you here.</Text>
                  <LinkButton label="Show me in Discover" onPress={() => router.push("/settings")} accessibilityHint="Opens Settings" />
                </View>
              </Card>
            ) : null}

            <View style={{ gap: spacing.space1 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: spacing.space4,
                  minHeight: MIN_TAP,
                }}
              >
                <Text variant="title" accessibilityRole="header">
                  Players near you
                </Text>
                {data.players.length > PREVIEW ? (
                  <LinkButton
                    label="See all"
                    onPress={() => router.push("/discover/players")}
                    accessibilityLabel={`See all ${data.players.length} players near you`}
                  />
                ) : null}
              </View>

              {data.players.length ? (
                data.players
                  .slice(0, PREVIEW)
                  .map((p) => (
                    <PlayerRow
                      key={p.userId}
                      player={p}
                      onPress={() => router.push({ pathname: "/discover/player/[userId]", params: { userId: String(p.userId) } })}
                    />
                  ))
              ) : (
                <View style={{ gap: spacing.space4, paddingBottom: spacing.space4 }}>
                  <EmptyState
                    symbol="person.2"
                    title="No players match yet"
                    message={
                      wider
                        ? `Widen to ${wider.radius} mi to see ${wider.count} ${wider.count === 1 ? "player" : "players"}, or invite a friend.`
                        : "Try a wider level range, or invite a friend to Ball Boi."
                    }
                  />
                  <View style={{ alignItems: "center", gap: spacing.space3 }}>
                    {wider ? (
                      <Button label={`Widen to ${wider.radius} mi`} onPress={() => setDiscoverFilters({ radius: wider.radius })} />
                    ) : null}
                    <Button label="Invite a friend" variant="secondary" onPress={invite} />
                  </View>
                </View>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </TabScreen>
  );
}
