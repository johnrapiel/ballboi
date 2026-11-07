// A player card from Discover (canvas W2_DiscoverPlayer, W2_PlayerMenu,
// W2_DiscoverPlayerLarge; F3, F8, F10, F13). Brush name, level, town and an
// approximate distance; Record / Played / No-shows read as one group; Plays,
// Free and Home court; "Set up a match" pinned at the bottom. More (•••)
// opens an action sheet with "Report [name]" and Cancel only. No handedness
// anywhere (F10). Back returns to the list where you left it.

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { ActionSheetIOS, Alert, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { IconButton } from "@/components/Choice";
import { DetailRow } from "@/components/discover/DetailRow";
import { ProblemCard } from "@/components/discover/States";
import { RatingBadge } from "@/components/RatingBadge";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useDiscoverPlayer } from "@/hooks/useDiscover";
import { useReportBlock } from "@/hooks/useReportBlock";
import { isOfflineError } from "@/lib/api";
import { cardStatsSpoken, playsLabel, whereLine, type DiscoverPlayerCard } from "@/lib/discover";
import { photoUrl } from "@/lib/photos";

export default function PlayerCardScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ userId: string }>();
  const userId = Number(params.userId);
  const player = useDiscoverPlayer(userId);
  const report = useReportBlock();
  const p = player.data;

  function more() {
    if (!p) return;
    const title = `Report ${p.name.split(" ")[0]}`;
    const go = () => report.open({ id: null, userId: p.userId, name: p.name });
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ options: [title, "Cancel"], cancelButtonIndex: 1 }, (i) => {
        if (i === 0) go();
      });
    } else {
      Alert.alert(p.name, undefined, [
        { text: title, onPress: go },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }

  // Setting up a match happens in chat (F2): open your chat with them.
  function setUpMatch() {
    if (!p) return;
    router.push({ pathname: "/conversation/[id]", params: { id: "new", userId: String(p.userId), name: p.name } });
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen
        options={{
          title: "",
          headerRight: p ? () => <IconButton symbol="ellipsis" label={`More options for ${p.name}`} onPress={more} /> : undefined,
        }}
      />
      {player.isLoading ? (
        <View style={{ padding: spacing.space4 }} accessible accessibilityLabel="Loading player">
          <Card style={{ height: 160, backgroundColor: c.sand, borderColor: c.sand }} />
        </View>
      ) : !p ? (
        <View style={{ padding: spacing.space4, gap: spacing.space3 }}>
          {player.error && /isn't in Discover/.test(player.error.message) ? (
            <Card style={{ gap: spacing.space2 }}>
              <Text variant="title">This player isn't in Discover right now</Text>
              <Text tone="inkMuted">They may have hidden their profile. Find someone else near you.</Text>
              <Button label="Back to Discover" variant="secondary" onPress={() => router.back()} />
            </Card>
          ) : (
            <ProblemCard
              title="Can't load this player right now"
              body={
                isOfflineError(player.error)
                  ? "You're offline. Check your connection and try again."
                  : "Check your connection and try again."
              }
              onRetry={() => void player.refetch()}
              retrying={player.isRefetching}
            />
          )}
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: spacing.space4, paddingBottom: 120 + insets.bottom, gap: spacing.space4 }}>
            <Header p={p} />
            <Stats p={p} />
            <Details p={p} />
          </ScrollView>
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: spacing.space4,
              paddingTop: spacing.space3,
              paddingBottom: insets.bottom + spacing.space3,
              borderTopWidth: 1,
              borderTopColor: c.hairline,
              backgroundColor: c.paper,
            }}
          >
            <Button label="Set up a match" onPress={setUpMatch} accessibilityHint={`Opens your chat with ${p.name}`} />
          </View>
        </>
      )}
    </View>
  );
}

function Header({ p }: { p: DiscoverPlayerCard }) {
  const where = whereLine(p);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space4 }}>
      <Avatar name={p.name} uri={photoUrl(p.avatarUrl)} size={72} />
      <View style={{ flexShrink: 1, flexGrow: 1, gap: spacing.space2 }}>
        <Text variant="brushM" accessibilityRole="header">
          {p.name}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space2 }}>
          {p.rating != null ? <RatingBadge rating={p.rating} source={p.ratingSource === "verified" ? "verified" : "self"} /> : null}
          {where ? (
            <Text variant="small" tone="inkMuted" accessibilityLabel={where.replace("~", "about ").replace(" mi ", " miles ")}>
              {where}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Record / Played / No-shows, side by side, or stacked at the largest text sizes. */
function Stats({ p }: { p: DiscoverPlayerCard }) {
  const c = useColors();
  const cells = [
    { label: "Record", value: `${p.wins}–${p.losses}` },
    { label: "Played", value: String(p.played) },
    { label: "No-shows", value: String(p.noShows) },
  ];
  return (
    <View
      accessible
      accessibilityLabel={cardStatsSpoken(p)}
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        backgroundColor: c.linen,
        borderWidth: 1,
        borderColor: c.hairline,
        borderRadius: 16,
        paddingVertical: spacing.space3,
      }}
    >
      {cells.map((cell, i) => (
        <View
          key={cell.label}
          style={{
            flexGrow: 1,
            flexBasis: 90,
            paddingHorizontal: spacing.space3,
            gap: 2,
            borderLeftWidth: i === 0 ? 0 : 1,
            borderLeftColor: c.hairline,
          }}
        >
          <Text variant="small" tone="inkMuted">
            {cell.label}
          </Text>
          <Text variant="title" style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>
            {cell.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Plays, Free and Home court. A long value ("Weekday evenings, weekend
 * mornings") wraps under its label without overlapping it, at every text
 * size (review finding 2).
 */
function Details({ p }: { p: DiscoverPlayerCard }) {
  const rows = [
    { label: "Plays", value: playsLabel(p.plays) },
    { label: "Free", value: p.freeSummary },
  ].filter((r): r is { label: string; value: string } => !!r.value);
  if (!rows.length) return null;
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      {rows.map((r, i) => (
        <DetailRow key={r.label} label={r.label} value={r.value} last={i === rows.length - 1} />
      ))}
    </Card>
  );
}
