// When I play (canvas W2_EditProfilePlay; F7, F8, F11), from Profile ›
// Player details. "I play" Singles and Doubles (either or both), and the
// "When you can play" row that opens the hour grid with your summary under
// it. Optional: it shows on your player card and powers "Free when I'm free".

import { useNavigation, usePreventRemove, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Alert, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChipRow, ChoiceChip } from "@/components/discover/Controls";
import { ProblemCard } from "@/components/discover/States";
import { SettingsRow, SettingsSection } from "@/components/SettingsList";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useDiscoverMe, useSaveDiscoverSettings } from "@/hooks/useDiscover";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { picksFromPlays, playsFromPicks } from "@/lib/discover";

export default function WhenIPlayScreen() {
  const c = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const me = useDiscoverMe();
  const save = useSaveDiscoverSettings();

  const [picks, setPicks] = useState<{ singles: boolean; doubles: boolean } | null>(null);
  useEffect(() => {
    if (me.data && !picks) setPicks(picksFromPlays(me.data.plays));
  }, [me.data, picks]);

  const plays = picks ? playsFromPicks(picks.singles, picks.doubles) : null;
  const dirty = !!me.data && !!picks && plays !== me.data.plays;
  const [leaving, setLeaving] = useState(false);
  usePreventRemove(dirty && !leaving, ({ data }) => {
    Alert.alert("Discard changes?", "What you picked won't be saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  useEffect(() => {
    if (leaving) router.back();
  }, [leaving, router]);

  async function onSave() {
    try {
      await save.mutateAsync({ plays });
      AccessibilityInfo.announceForAccessibility("Saved");
      setLeaving(true);
    } catch (e) {
      Alert.alert("Couldn't save", isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Try again.");
    }
  }

  if (!me.data || !picks) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space4 }}>
        {me.isError ? (
          <ProblemCard title="Can't load this right now" body="Check your connection and try again." onRetry={() => void me.refetch()} retrying={me.isRefetching} />
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <ScrollView contentContainerStyle={{ padding: spacing.space4, paddingBottom: 120 + insets.bottom, gap: spacing.space6 }}>
        <View style={{ gap: spacing.space2 }}>
          <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
            I play
          </Text>
          <ChipRow label="I play">
            <ChoiceChip label="Singles" selected={picks.singles} onPress={() => setPicks({ ...picks, singles: !picks.singles })} />
            <ChoiceChip label="Doubles" selected={picks.doubles} onPress={() => setPicks({ ...picks, doubles: !picks.doubles })} />
          </ChipRow>
        </View>
        <SettingsSection footer="Optional. Shows on your player card and helps players near you find a time.">
          <SettingsRow
            title="When you can play"
            subtitle={me.data.freeSummary ?? "Not set"}
            onPress={() => router.push("/availability")}
            accessibilityHint="Opens the hour grid, Monday to Sunday"
            last
          />
        </SettingsSection>
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
        <Button label="Save" onPress={() => void onSave()} loading={save.isPending} disabled={!dirty} />
      </View>
    </View>
  );
}
