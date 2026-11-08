// Free times (decision 139; canvas W2_FreeTimesSheet): a read-only sheet of
// the Monday to Sunday hour grid, from the player card's Free times. On your
// own card, Edit opens the grid editor. Sheet rules: the left-aligned 50%
// serif title, drag down to close. With `userId`, it's another player's
// (Discover's card, decision 139): read only, with no Edit.

import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { getGetMyPlayerCardQueryKey, getGetPlayerCardQueryKey, useGetMyPlayerCard, useGetPlayerCard } from "@workspace/api-client-react";

import { FreeTimesGrid } from "@/components/card/FreeTimesGrid";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { freeTimesSpoken, hoursFreeWeek } from "@/lib/playerCard";

export default function FreeTimesSheet() {
  const c = useColors();
  const router = useRouter();
  const sheet = useSheetClose(false);
  const params = useLocalSearchParams<{ userId?: string }>();
  const userId = Number(params.userId);
  const theirs = Number.isInteger(userId) && userId > 0;
  const mine = useGetMyPlayerCard({ query: { enabled: !theirs, queryKey: getGetMyPlayerCardQueryKey() } });
  const other = useGetPlayerCard(userId, { query: { enabled: theirs, queryKey: getGetPlayerCardQueryKey(userId) } });
  const q = theirs ? other : mine;
  const card = q.data;

  return (
    <SheetBody title={card && !card.you ? `${card.name.split(" ")[0]}'s free times` : "Free times"} close={sheet.close}>
      {!card ? (
        q.isError ? (
          <Text tone="inkMuted">Couldn't load free times. Close this and try again.</Text>
        ) : (
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading free times" />
        )
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.space2 }}>
            {/* The swatch is the key: filled squares are free hours. */}
            <View style={{ width: 14, height: 14, borderRadius: radius.radiusSm - 1, backgroundColor: c.ink }} />
            <Text variant="small" tone="inkMuted">
              {hoursFreeWeek(card.slots.length)}
            </Text>
            {card.you ? (
              <Pressable
                onPress={() => sheet.finish(() => router.replace("/availability"))}
                accessibilityRole="button"
                accessibilityLabel="Edit free times"
                hitSlop={spacing.space2}
                style={({ pressed }) => ({ minHeight: MIN_TAP, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
              >
                <Text variant="small" style={{ textDecorationLine: "underline" }}>
                  Edit
                </Text>
              </Pressable>
            ) : null}
          </View>
          <FreeTimesGrid slots={card.slots} spoken={freeTimesSpoken(card.freeSummary, card.slots.length, card.you)} />
        </>
      )}
    </SheetBody>
  );
}
