import { useAuth } from "@clerk/expo";
import React, { useEffect, useState } from "react";
import { Alert, Linking, View } from "react-native";

import { Toggle } from "@/components/Toggle";
import { Card, Text, TextLink } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useNotificationAccess } from "@/hooks/useNotificationAccess";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { saveMatchReminders } from "@/lib/notifications";

const TITLE = "Match day reminders";
const BODY = "A reminder at 8 AM the day before each match.";

/**
 * "Match day reminders" on the Profile tab (Wave 2, spec decision 73): on by
 * default, saved to the account so it's the same on every phone. When iOS
 * notifications are off for Ball Boi, says so and links to Settings, since
 * the switch alone can't bring reminders back.
 */
export function MatchRemindersRow({ enabled }: { enabled: boolean | null }) {
  const { getToken } = useAuth();
  const access = useNotificationAccess();
  const [value, setValue] = useState(enabled ?? true);
  const [saving, setSaving] = useState(false);

  // The saved value, once the profile loads or reloads.
  useEffect(() => {
    if (enabled != null) setValue(enabled);
  }, [enabled]);

  async function change(on: boolean) {
    const before = value;
    setValue(on); // Shown at once; put back if the server says no.
    setSaving(true);
    try {
      await saveMatchReminders(on, getToken);
    } catch (e) {
      setValue(before);
      Alert.alert("Couldn't save", isOfflineError(e) ? OFFLINE_MESSAGE : "Try again in a moment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={{ gap: spacing.space3, marginBottom: spacing.space3 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3, minHeight: MIN_TAP }}>
        <Text variant="bodyStrong" style={{ flex: 1 }} importantForAccessibility="no" accessibilityElementsHidden>
          {TITLE}
        </Text>
        <Toggle
          value={value}
          onValueChange={(on) => void change(on)}
          disabled={saving || enabled == null}
          accessibilityLabel={TITLE}
          accessibilityHint={BODY}
        />
      </View>
      <Text tone="inkMuted">{BODY}</Text>
      {access === "off" && value ? (
        <Text>
          Notifications are off for Ball Boi, so reminders can't reach you.{" "}
          <TextLink onPress={() => void Linking.openSettings()} accessibilityHint="Opens Ball Boi in iOS Settings">
            Open Settings
          </TextLink>
        </Text>
      ) : null}
    </Card>
  );
}
