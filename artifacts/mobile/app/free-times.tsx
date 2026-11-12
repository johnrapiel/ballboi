// Free times (decisions 139 and 156; finding 17, John, Nov 11: layout A),
// from the player card's Free times. One row per day they're free: the
// short day in bold on the left ("Tue"), each time on its own line on the
// right ("7 AM to 12 PM"), earliest first, overlapping times merged. No
// summary line and no Morning, Afternoon or Evening words. On your own card
// the brush pencil on the title line opens the editor (When you can play);
// with `userId` it's another player's (Discover's card), read only, and with
// none added it says so: "Ross hasn't added free times yet." (finding 13).
// Sheet rules: left-aligned 50% serif title, drag down to close.

import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, View, useWindowDimensions } from "react-native";

import { getGetMyPlayerCardQueryKey, getGetPlayerCardQueryKey, useGetMyPlayerCard, useGetPlayerCard } from "@workspace/api-client-react";

import { LinkButton } from "@/components/discover/Controls";
import { Icon } from "@/components/Icon";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { noFreeTimesLine, sheetDays } from "@/lib/freeTimes";

export default function FreeTimesSheet() {
  const c = useColors();
  const router = useRouter();
  const sheet = useSheetClose(false);
  const { fontScale } = useWindowDimensions();
  const params = useLocalSearchParams<{ userId?: string }>();
  const userId = Number(params.userId);
  const theirs = Number.isInteger(userId) && userId > 0;
  const mine = useGetMyPlayerCard({ query: { enabled: !theirs, queryKey: getGetMyPlayerCardQueryKey() } });
  const other = useGetPlayerCard(userId, { query: { enabled: theirs, queryKey: getGetPlayerCardQueryKey(userId) } });
  const q = theirs ? other : mine;
  const card = q.data;
  const days = card ? sheetDays(card.freeTimes ?? []) : [];
  const edit = () => sheet.finish(() => router.replace("/availability"));
  // At the accessibility text sizes the day sits on its own line above its times.
  const stack = fontScale >= 2;

  const pencil = card?.you ? (
    <Pressable
      onPress={edit}
      accessibilityRole="button"
      accessibilityLabel="Edit free times"
      hitSlop={4}
      style={({ pressed }) => ({ width: MIN_TAP, height: MIN_TAP, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name="pencil" size={24} tintColor={c.ink} />
    </Pressable>
  ) : null;

  return (
    <SheetBody title={card && !card.you ? `${card.name.split(" ")[0]}'s free times` : "Free times"} close={sheet.close} titleAction={pencil}>
      {!card ? (
        q.isError ? (
          <Text tone="inkMuted">Couldn't load free times. Close this and try again.</Text>
        ) : (
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading free times" />
        )
      ) : days.length ? (
        <View>
          {days.map((d, i) => (
            <View
              key={d.day}
              accessible
              accessibilityLabel={d.spoken}
              style={{
                flexDirection: stack ? "column" : "row",
                gap: stack ? spacing.space1 : spacing.space4,
                paddingVertical: spacing.space3,
                borderTopWidth: i ? 1 : 0,
                borderTopColor: c.hairline,
              }}
            >
              <Text variant="bodyStrong" style={stack ? undefined : { width: Math.round(48 * Math.max(fontScale, 1)) }}>
                {d.short}
              </Text>
              <View style={{ flex: stack ? undefined : 1, gap: spacing.space1 }}>
                {d.times.map((t) => (
                  <Text key={t}>{t}</Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <>
          <Text tone="inkMuted">{noFreeTimesLine(card.name, card.you)}</Text>
          {card.you ? <LinkButton label="Add free times" accessibilityLabel="Add free times" onPress={edit} /> : null}
        </>
      )}
    </SheetBody>
  );
}
