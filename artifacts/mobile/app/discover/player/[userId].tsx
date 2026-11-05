import { getGetDiscoverPlayerQueryKey, getGetDiscoverPlayersQueryKey, useGetDiscoverPlayer } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import React from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { IconButton } from "@/components/Choice";
import { RatingBadge } from "@/components/RatingBadge";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useReportBlock } from "@/hooks/useReportBlock";
import { freeTimesLine, PLAYS_LABEL } from "@/lib/discover";
import { photoUrl } from "@/lib/photos";

// A Discover player's profile (spec: Discover, "From found to playing").
// What they've shared for Discover and nothing more: level, approximate
// distance, what they play, when they're usually free, matches played.
// Message lands in their Message Requests. More has Report and Block.

function Fact({ symbol, label, value }: { symbol: SFSymbol; label: string; value: string }) {
  const c = useColors();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3, minHeight: 32 }}>
      <SymbolView name={symbol} size={18} tintColor={c.inkMuted} />
      <View style={{ flex: 1 }}>
        <Text variant="small" tone="inkMuted">
          {label}
        </Text>
        <Text>{value}</Text>
      </View>
    </View>
  );
}

export default function DiscoverPlayerScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { userId: raw } = useLocalSearchParams<{ userId: string }>();
  const userId = Number(raw);
  const query = useGetDiscoverPlayer(userId, {
    query: { enabled: Number.isInteger(userId), retry: false, queryKey: getGetDiscoverPlayerQueryKey(userId) },
  });
  const p = query.data;
  const { open } = useReportBlock({
    onBlocked: () => {
      void queryClient.invalidateQueries({ queryKey: getGetDiscoverPlayersQueryKey() });
      router.back();
    },
  });

  const message = () => {
    if (!p) return;
    router.push({ pathname: "/conversation/[id]", params: { id: "new", userId: String(p.userId), name: p.name } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen
        options={{
          headerRight: p
            ? () => <IconButton symbol="ellipsis" label={`More options for ${p.name}`} onPress={() => open({ id: p.userId, name: p.name, kind: "user" })} />
            : undefined,
        }}
      />
      {query.isPending && Number.isInteger(userId) ? (
        <ActivityIndicator style={{ marginTop: spacing.space12 }} color={c.ink} accessibilityLabel="Loading player" />
      ) : !p ? (
        <View style={{ padding: spacing.space6, gap: spacing.space4, alignItems: "center" }}>
          <Text tone="inkMuted" style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
            {query.error && (query.error as { status?: number }).status !== 404
              ? "This player didn't load. Check your connection and try again."
              : "This player isn't in Discover right now."}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => void query.refetch()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space6, gap: spacing.space4 }}>
          <View style={{ alignItems: "center", gap: spacing.space3 }}>
            <Avatar name={p.name} uri={photoUrl(p.avatarUrl)} size={96} />
            <Text variant="displayL" accessibilityRole="header" style={{ textAlign: "center" }}>
              {p.name}
            </Text>
            {p.rating != null ? (
              <RatingBadge rating={p.rating} source={p.ratingSource === "verified" ? "verified" : "self"} />
            ) : (
              <Text tone="inkMuted">Level not set</Text>
            )}
          </View>

          <Card style={{ gap: spacing.space3 }}>
            <Fact symbol="location" label="Distance" value={p.distanceLabel} />
            <Fact symbol="figure.tennis" label="Plays" value={p.plays ? PLAYS_LABEL[p.plays] : "Not shared"} />
            <Fact symbol="calendar" label="Usually free" value={freeTimesLine(p.freeTimes) ?? "Not shared"} />
            <Fact symbol="checkmark.circle" label="Matches on Ball Boi" value={`Played ${p.played}`} />
          </Card>

          <Button label={`Message ${p.name}`} onPress={message} />
          <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
            Your first message lands in their Message Requests.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}
