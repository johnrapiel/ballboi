import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, FlatList, RefreshControl, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useBlockedPlayers, useUnblock, type BlockedPlayer } from "@/hooks/useBlockedPlayers";
import { useColors } from "@/hooks/useColors";
import { photoUrl } from "@/lib/photos";

// Blocked players (opens from Profile; moves under Settings > Privacy in Wave 2).
// Spec: Messaging and moderation ("Block stops DMs both ways and hides both
// players from each other in search and pairings"). App Store 1.2.

function blockedOn(iso: string) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

function spokenDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export default function BlockedPlayersScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const blocked = useBlockedPlayers();
  const unblock = useUnblock();
  const [busyId, setBusyId] = useState<number | null>(null);
  // At the largest text sizes the Unblock button moves under the name, so neither clips.
  const stacked = useWindowDimensions().fontScale >= 1.6;
  const loadFailed = blocked.isError && !blocked.data;

  // iOS has no live regions: say the load error out loud when it appears.
  useEffect(() => {
    if (loadFailed) AccessibilityInfo.announceForAccessibility("Couldn't load blocked players");
  }, [loadFailed]);

  const confirmUnblock = (player: BlockedPlayer & { playerId: number }) =>
    Alert.alert(
      `Unblock ${player.name}?`,
      "They'll be able to message you and appear in your leagues and pairings again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unblock",
          onPress: () => {
            setBusyId(player.playerId);
            unblock(player)
              .then(() => AccessibilityInfo.announceForAccessibility(`${player.name} unblocked`))
              .catch((e: Error) => Alert.alert(`Couldn't unblock ${player.name}`, e.message))
              .finally(() => setBusyId(null));
          },
        },
      ],
    );

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Blocked players",
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerTintColor: c.ink,
          headerStyle: { backgroundColor: c.paper },
          headerTitleStyle: { fontFamily: "DMSans_600SemiBold", color: c.ink },
        }}
      />

      {blocked.isPending ? (
        <ActivityIndicator style={{ marginTop: spacing.space12 }} color={c.ink} accessibilityLabel="Loading blocked players" />
      ) : loadFailed ? (
        <View style={{ padding: spacing.space6, gap: spacing.space4, alignItems: "center" }}>
          <Text variant="bodyStrong" style={{ textAlign: "center" }}>
            Couldn't load blocked players
          </Text>
          <Text tone="inkMuted" style={{ textAlign: "center" }}>
            {blocked.error.message}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => void blocked.refetch()} />
        </View>
      ) : (
        <FlatList
          data={blocked.data}
          keyExtractor={(p) => `${p.playerId ?? p.name}-${p.blockedAt}`}
          refreshControl={<RefreshControl refreshing={blocked.isRefetching} onRefresh={() => void blocked.refetch()} tintColor={c.ink} />}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + spacing.space6 }}
          ListHeaderComponent={
            blocked.data.length ? (
              <Text tone="inkMuted" style={{ paddingHorizontal: spacing.space4, paddingTop: spacing.space3, paddingBottom: spacing.space2 }}>
                You and these players can't message each other or see each other in search, leagues or pairings. They aren't told.
              </Text>
            ) : undefined
          }
          renderItem={({ item }) => (
            <View
              style={{
                minHeight: 72,
                flexDirection: stacked ? "column" : "row",
                alignItems: stacked ? "stretch" : "center",
                gap: spacing.space3,
                paddingHorizontal: spacing.space4,
                paddingVertical: spacing.space3,
                borderBottomWidth: 1,
                borderBottomColor: c.hairline,
              }}
            >
              <View style={{ flex: stacked ? undefined : 1, flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
                <Avatar name={item.name} uri={photoUrl(item.avatarUrl)} size={44} />
                <View accessible accessibilityLabel={`${item.name}. Blocked ${spokenDate(item.blockedAt)}`} style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{item.name}</Text>
                  <Text variant="small" tone="inkMuted">
                    Blocked {blockedOn(item.blockedAt)}
                  </Text>
                </View>
              </View>
              {item.playerId !== null ? (
                <Button
                  label="Unblock"
                  variant="secondary"
                  loading={busyId === item.playerId}
                  disabled={busyId !== null}
                  onPress={() => confirmUnblock(item as BlockedPlayer & { playerId: number })}
                  accessibilityLabel={`Unblock ${item.name}`}
                />
              ) : (
                // Rare: the blocked account has no player profile to unblock through.
                <Text variant="small" tone="inkMuted" style={{ maxWidth: stacked ? undefined : 120 }}>
                  Email support@ballboi.tennis to unblock
                </Text>
              )}
            </View>
          )}
          ListEmptyComponent={
            <View
              accessible
              style={{ flex: 1, minHeight: 320, alignItems: "center", justifyContent: "center", gap: spacing.space3, paddingHorizontal: spacing.space8 }}
            >
              <SymbolView name="hand.raised" size={40} tintColor={c.inkMuted} />
              <Text variant="title" style={{ textAlign: "center" }}>
                You haven't blocked anyone.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
