// The reason screen before the iOS notification prompt (spec: Permissions are
// asked only when needed; decisions 11 and 73). Opens once per phone, as a
// native sheet, after joining a league (and, with Discover, after sending a
// match request). "Turn on reminders" shows the iOS prompt; "Not now" or a
// swipe down closes it, and Ball Boi doesn't ask again. Reminders still arrive
// quietly in Notification Center either way, until the player turns them off.

import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { requestFullNotifications } from "@/lib/notifications";

export const REMINDER_REASON_COPY =
  "Ball Boi reminds you at 8 AM the day before each match, with who you're playing, when and where. iOS asks next.";

export default function MatchRemindersReason() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const close = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)"));

  async function turnOn() {
    if (busy) return;
    setBusy(true);
    await requestFullNotifications(getToken);
    setBusy(false);
    close();
  }

  return (
    <View
      style={{
        backgroundColor: c.linen,
        paddingTop: spacing.space6,
        paddingHorizontal: spacing.space6,
        paddingBottom: insets.bottom + spacing.space4,
        gap: spacing.space4,
      }}
    >
      <View style={{ gap: spacing.space2 }}>
        <Text variant="titleItalic" accessibilityRole="header">
          Get match day reminders
        </Text>
        <Text tone="inkMuted">{REMINDER_REASON_COPY}</Text>
      </View>
      <View style={{ gap: spacing.space3, marginTop: spacing.space2 }}>
        <Button
          label="Turn on reminders"
          onPress={() => void turnOn()}
          loading={busy}
          accessibilityHint="Shows the iOS notifications prompt"
        />
        <Button label="Not now" variant="secondary" onPress={close} />
      </View>
    </View>
  );
}
