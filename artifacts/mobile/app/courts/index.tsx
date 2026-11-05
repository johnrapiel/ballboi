import {
  getGetCourtsQueryKey,
  getGetMyDiscoverSettingsQueryKey,
  useGetCourts,
  useGetMyDiscoverSettings,
  useSetMyHomeCourt,
  type CourtCard,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChoiceGroup, IconButton } from "@/components/Choice";
import { LinkButton } from "@/components/discover/LinkButton";
import { Button, Field, Text } from "@/components/ui";
import { radius as radii, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useReportCourt } from "@/hooks/useReportCourt";
import { courtLine, RADII, searchCourts, type Radius } from "@/lib/discover";

// Settings > Discover > Home court (spec: Discover, "Court directory: public
// and club courts with surface, lights, and court count; players can add
// missing courts. Feeds home court, match requests, and open matches";
// Onboarding, "home court optional"). Pick one, or add the one that's missing.

function CourtRow({
  court,
  mine,
  onPick,
  onMore,
}: {
  court: CourtCard;
  mine: boolean;
  onPick: () => void;
  onMore: () => void;
}) {
  const c = useColors();
  const line = courtLine(court);
  return (
    <View
      style={{
        marginHorizontal: spacing.space4,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: radii.radiusLg,
        borderWidth: mine ? 2 : 1,
        borderColor: mine ? c.ink : c.hairline,
        backgroundColor: c.linen,
      }}
    >
      <Pressable
        onPress={onPick}
        accessibilityRole="button"
        accessibilityState={{ selected: mine }}
        accessibilityLabel={`${court.name}${court.place ? `, ${court.place}` : ""}. ${line.replace(/ · /g, ", ").replace("~", "about ")}${mine ? ". Your home court" : ""}`}
        accessibilityHint={mine ? undefined : "Makes it your home court"}
        style={({ pressed }) => ({ flex: 1, padding: spacing.space4, gap: spacing.space1, opacity: pressed ? 0.7 : 1 })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
          {mine ? <SymbolView name="checkmark.circle.fill" size={18} tintColor={c.ink} /> : null}
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {court.name}
          </Text>
        </View>
        {mine ? (
          <Text variant="small" tone="ink">
            Your home court
          </Text>
        ) : null}
        {court.place ? <Text variant="small">{court.place}</Text> : null}
        <Text variant="small" tone="inkMuted">
          {line}
        </Text>
      </Pressable>
      <IconButton symbol="ellipsis" label={`More options for ${court.name}`} onPress={onMore} />
    </View>
  );
}

export default function HomeCourtScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [radius, setRadius] = useState<Radius>(10);
  const [search, setSearch] = useState("");
  const params = { radius };
  const list = useGetCourts(params, { query: { queryKey: getGetCourtsQueryKey(params) } });
  const settings = useGetMyDiscoverSettings();
  const save = useSetMyHomeCourt();
  const report = useReportCourt();
  const homeCourtId = list.data?.homeCourtId ?? settings.data?.homeCourt?.courtId ?? null;

  const setHome = (court: CourtCard | null) =>
    save.mutate(
      { data: { courtId: court?.courtId ?? null } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetCourtsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetMyDiscoverSettingsQueryKey() });
          AccessibilityInfo.announceForAccessibility(court ? `${court.name} is your home court.` : "Home court removed.");
          if (court) router.back();
        },
        onError: () => Alert.alert("Couldn't save", "Check your connection and try again."),
      },
    );

  const courts = searchCourts(list.data?.courts ?? [], search);
  const problem = list.data?.homeAreaProblem;

  const header = (
    <View style={{ paddingHorizontal: spacing.space4, gap: spacing.space4, paddingBottom: spacing.space2 }}>
      <Text tone="inkMuted">Pick the court you play at most. Players see it on your Discover profile.</Text>
      {homeCourtId != null ? (
        <Button variant="secondary" label="Remove home court" loading={save.isPending} onPress={() => setHome(null)} />
      ) : null}
      <Field
        label="Search courts"
        value={search}
        onChangeText={setSearch}
        placeholder="Court or park name"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      <ChoiceGroup<Radius>
        label="Distance from your home area"
        value={radius}
        onChange={setRadius}
        options={RADII.map((r) => ({ value: r, label: `${r} mi`, accessibilityLabel: `${r} miles` }))}
      />
    </View>
  );

  const footer = (
    <View style={{ paddingHorizontal: spacing.space4, paddingTop: spacing.space2, gap: spacing.space2 }}>
      {problem ? null : (
        <LinkButton
          label={courts.length ? "Can't find it? Add a court" : "Add a court"}
          accessibilityHint="Adds a missing court for everyone"
          onPress={() => router.push("/courts/new")}
        />
      )}
    </View>
  );

  if (list.isPending)
    return (
      <View style={{ flex: 1, backgroundColor: c.paper }}>
        <ActivityIndicator style={{ marginTop: spacing.space12 }} color={c.ink} accessibilityLabel="Loading courts" />
      </View>
    );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ paddingTop: spacing.space4, paddingBottom: insets.bottom + spacing.space6, gap: spacing.space3 }}
      keyboardShouldPersistTaps="handled"
      data={courts}
      keyExtractor={(court) => String(court.courtId)}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={
        <View style={{ paddingHorizontal: spacing.space4, gap: spacing.space3 }}>
          <Text tone="inkMuted" accessibilityLiveRegion="polite">
            {list.isError
              ? "Courts didn't load. Check your connection and try again."
              : problem
                ? problem
                : search.trim()
                  ? `No courts match "${search.trim()}" within ${radius} mi.`
                  : `No courts within ${radius} mi yet. Add the one you play at so others can find it.`}
          </Text>
          {list.isError ? <Button variant="secondary" label="Try again" onPress={() => void list.refetch()} /> : null}
          {problem ? (
            <Button variant="secondary" label="Add your home area" onPress={() => router.push("/profile/edit/home")} />
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <CourtRow
          court={item}
          mine={item.courtId === homeCourtId}
          onPick={() => (item.courtId === homeCourtId ? undefined : setHome(item))}
          onMore={() => report(item)}
        />
      )}
    />
  );
}
