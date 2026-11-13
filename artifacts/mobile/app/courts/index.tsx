// The court directory (F4; brief items 23 to 26). A searchable list, nearest
// first ("Beacon Courts · ~3 mi"), with "Add a court" when one is missing.
// No map. Opens from Settings › Discover › Home court (mode "home": picking
// saves it) and from the court field in Post an open match (mode "match":
// picking hands it back, and "Court not set" is allowed).

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "@/components/Icon";
import React, { useState } from "react";
import { AccessibilityInfo, Alert, Pressable, ScrollView, View } from "react-native";

import { ProblemCard } from "@/components/discover/States";
import { SearchField } from "@/components/players/SearchField";
import { Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { courtPick, useCourts, usePickedCourt, useSetHomeCourt } from "@/hooks/useCourts";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { courtLine, courtSpoken, type CourtCard } from "@/lib/discover";

export default function CourtsScreen() {
  const c = useColors();
  const router = useRouter();
  const bottom = useScreenBottomInset();
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode = params.mode === "match" ? "match" : "home";
  const [query, setQuery] = useState("");
  const list = useCourts(query);
  const setHome = useSetHomeCourt();
  const picked = usePickedCourt();
  const selectedId = mode === "home" ? (list.data?.homeCourtId ?? null) : (picked?.courtId ?? null);

  async function pick(court: CourtCard | null) {
    if (mode === "match") {
      courtPick.set(court);
      router.back();
      return;
    }
    try {
      await setHome.mutateAsync(court?.courtId ?? null);
      AccessibilityInfo.announceForAccessibility(court ? `Home court: ${court.name}` : "Home court cleared");
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save", isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Try again.");
    }
  }

  const courts = list.data?.courts ?? [];
  const typed = query.trim().length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen options={{ title: mode === "home" ? "Home court" : "Court" }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: bottom.paddingBottom, gap: spacing.space3 }}
        scrollIndicatorInsets={bottom.scrollIndicatorInsets}
      >
        <SearchField
          value={query}
          onChangeText={setQuery}
          label="Search courts"
          placeholder="Search by name or town"
          busy={list.searching}
        />

        {list.isLoading ? (
          <Text tone="inkMuted" accessibilityRole="progressbar">
            Finding courts near you…
          </Text>
        ) : list.isError && !list.data ? (
          <ProblemCard
            title="Can't load courts right now"
            body={
              isOfflineError(list.error) ? "You're offline. Check your connection and try again." : "Check your connection and try again."
            }
            onRetry={() => void list.refetch()}
            retrying={list.isRefetching}
          />
        ) : (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {mode === "match" ? (
              <Row
                title="Court not set"
                subtitle="Decide the court in the group chat"
                selected={picked === null}
                onPress={() => void pick(null)}
              />
            ) : list.data?.homeCourtId ? (
              <Row title="No home court" subtitle="Clear your home court" selected={false} onPress={() => void pick(null)} />
            ) : null}
            {courts.map((court) => (
              <Row
                key={court.courtId}
                title={courtLine(court)}
                subtitle={court.address}
                selected={court.courtId === selectedId}
                spoken={courtSpoken(court, court.courtId === selectedId)}
                onPress={() => void pick(court)}
              />
            ))}
            {courts.length === 0 ? (
              <View style={{ padding: spacing.space4, gap: spacing.space1 }}>
                <Text variant="bodyStrong">{typed ? `No courts match "${query.trim()}"` : "No courts near you yet"}</Text>
                <Text variant="small" tone="inkMuted">
                  Add it, and players near you can pick it too.
                </Text>
              </View>
            ) : null}
            <Row
              title="Add a court"
              subtitle="Name and address"
              symbol="plus"
              last
              onPress={() => router.push({ pathname: "/courts/new", params: { mode, name: query.trim() } })}
            />
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

function Row({
  title,
  subtitle,
  selected,
  onPress,
  spoken,
  symbol,
  last,
}: {
  title: string;
  subtitle?: string;
  selected?: boolean;
  onPress: () => void;
  spoken?: string;
  symbol?: "plus";
  last?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken ?? [title, subtitle, selected ? "selected" : null].filter(Boolean).join(", ")}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => ({
        minHeight: Math.max(MIN_TAP, 56),
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {symbol ? <Icon name="plus.circle" size={20} tintColor={c.ink} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant={selected || symbol ? "bodyStrong" : "body"}>{title}</Text>
        {subtitle ? (
          <Text variant="small" tone="inkMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {/* A check, not color, marks the court picked (a list, not a chip). */}
      <View style={{ width: 20, alignItems: "center" }}>
        {selected ? <Icon name="checkmark" size={16} tintColor={c.ink} /> : null}
      </View>
    </Pressable>
  );
}
