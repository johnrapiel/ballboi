// Free times (decisions 139 and 156; canvas W2_FreeTimesSheet), from the
// player card's Free times. The card's one-line summary, then a plain list of
// only the days they're free: "Tue: Evening, 5 to 9 PM", "Sat: Morning, 7 to
// 11 AM; 1 to 3 PM". No pills here. On your own card, Edit opens the editor
// (When you can play); with `userId` it's another player's (Discover's card)
// and read only. Sheet rules: left-aligned 50% serif title, drag down to close.

import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, View } from "react-native";

import { getGetMyPlayerCardQueryKey, getGetPlayerCardQueryKey, useGetMyPlayerCard, useGetPlayerCard } from "@workspace/api-client-react";

import { LinkButton } from "@/components/discover/Controls";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { dayLines, freeTimesLine } from "@/lib/freeTimes";

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
  const lines = card ? dayLines(card.freeTimes ?? []) : [];

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
          <Text variant="bodyStrong">{freeTimesLine(lines.length ? card.freeSummary : null, card.you)}</Text>
          {lines.length ? (
            <View style={{ gap: spacing.space2 }}>
              {lines.map((l) => (
                <Text key={l.day} accessibilityLabel={l.spoken}>
                  {l.text}
                </Text>
              ))}
            </View>
          ) : null}
          {card.you ? (
            <LinkButton
              label={lines.length ? "Edit" : "Add free times"}
              accessibilityLabel={lines.length ? "Edit free times" : "Add free times"}
              onPress={() => sheet.finish(() => router.replace("/availability"))}
            />
          ) : null}
        </>
      )}
    </SheetBody>
  );
}
