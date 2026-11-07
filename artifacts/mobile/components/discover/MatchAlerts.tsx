// "Get alerts for new posts" (canvas W2_MatchAlerts; brief item 45). Open
// matches near you that fit your level, up to 2 a day. Off unless you turn
// it on. When iOS notifications are off for Ball Boi, a one-line note links
// to iOS Settings.

import * as Notifications from "expo-notifications";
import React, { useEffect, useState } from "react";
import { Alert, Linking, View } from "react-native";

import { LinkButton } from "@/components/discover/Controls";
import { Toggle } from "@/components/Toggle";
import { Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useSaveDiscoverSettings } from "@/hooks/useDiscover";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";

export function useNotificationsDenied(): boolean {
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    Notifications.getPermissionsAsync()
      .then((p) => setDenied(p.status === "denied"))
      .catch(() => setDenied(false));
  }, []);
  return denied;
}

export function MatchAlertsCard({ on, title = "Get alerts for new posts" }: { on: boolean; title?: string }) {
  const save = useSaveDiscoverSettings();
  const denied = useNotificationsDenied();

  async function change(v: boolean) {
    try {
      await save.mutateAsync({ matchAlerts: v });
    } catch (e) {
      Alert.alert("Couldn't save", isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Try again.");
    }
  }

  return (
    <Card style={{ gap: spacing.space2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3, minHeight: MIN_TAP }}>
        <Text variant="bodyStrong" style={{ flex: 1 }} importantForAccessibility="no" accessibilityElementsHidden>
          {title}
        </Text>
        <Toggle
          value={on}
          onValueChange={(v) => void change(v)}
          disabled={save.isPending}
          accessibilityLabel={title}
          accessibilityHint="Open matches near you that fit your level. Up to 2 a day."
        />
      </View>
      <Text tone="inkMuted">Open matches near you that fit your level. Up to 2 a day.</Text>
      {on && denied ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.space2 }}>
          <Text variant="small" tone="inkMuted">
            Notifications are off for Ball Boi.
          </Text>
          <LinkButton label="Open iOS Settings" onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}
    </Card>
  );
}
