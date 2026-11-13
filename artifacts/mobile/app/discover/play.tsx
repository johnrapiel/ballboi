// Plays, from Edit profile's Plays row and the card's "Add how you play"
// prompt: the Singles and Doubles chips (either or both) and Save. Nothing
// else (John, Nov 9): free times have their own editor, opened from Edit
// profile's Free times row. Optional: it shows on your player card.

import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Alert, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChipRow, ChoiceChip } from "@/components/discover/Controls";
import { ProblemCard } from "@/components/discover/States";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { useDiscoverMe, useSaveDiscoverSettings } from "@/hooks/useDiscover";
import { usePinnedBarHeight, useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { picksFromPlays, playsFromPicks } from "@/lib/discover";

export default function WhenIPlayScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The last content sits a full gap above the pinned button (decision 194).
  const pinned = usePinnedBarHeight();
  const bottom = useScreenBottomInset({ pinnedHeight: pinned.height });
  const me = useDiscoverMe();
  const save = useSaveDiscoverSettings();

  const [picks, setPicks] = useState<{ singles: boolean; doubles: boolean } | null>(null);
  useEffect(() => {
    if (me.data && !picks) setPicks(picksFromPlays(me.data.plays));
  }, [me.data, picks]);

  const plays = picks ? playsFromPicks(picks.singles, picks.doubles) : null;
  const dirty = !!me.data && !!picks && plays !== me.data.plays;
  const guard = useDiscardGuard(dirty, { title: "Discard changes?", message: "What you picked won't be saved." });

  async function onSave() {
    try {
      await save.mutateAsync({ plays });
      AccessibilityInfo.announceForAccessibility("Saved");
      guard.finish();
    } catch (e) {
      Alert.alert("Couldn't save", isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Try again.");
    }
  }

  if (!me.data || !picks) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space4 }}>
        {me.isError ? (
          <ProblemCard
            title="Can't load this right now"
            body="Check your connection and try again."
            onRetry={() => void me.refetch()}
            retrying={me.isRefetching}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <ScrollView contentContainerStyle={{ padding: spacing.space4, paddingBottom: bottom.paddingBottom, gap: spacing.space6 }} scrollIndicatorInsets={bottom.scrollIndicatorInsets}>
        <View style={{ gap: spacing.space2 }}>
          <Text variant="headingL" accessibilityRole="header">
            Plays
          </Text>
          <Text tone="inkMuted">Pick one or both. It shows on your player card.</Text>
        </View>
        <View style={{ gap: spacing.space2 }}>
          <Text variant="section" tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
            I play
          </Text>
          <ChipRow label="I play">
            <ChoiceChip label="Singles" selected={picks.singles} onPress={() => setPicks({ ...picks, singles: !picks.singles })} />
            <ChoiceChip label="Doubles" selected={picks.doubles} onPress={() => setPicks({ ...picks, doubles: !picks.doubles })} />
          </ChipRow>
        </View>
      </ScrollView>
      <View
        onLayout={pinned.onLayout}
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
