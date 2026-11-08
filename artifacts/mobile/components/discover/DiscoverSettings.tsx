// Settings › Discover (canvas W2_SettingsDiscover; F3: no Blocked players
// row). "Show me in Discover", Your area and Home court. and Alerts for new
// open matches.

import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Alert, View } from "react-native";

import { MatchAlertsCard } from "@/components/discover/MatchAlerts";
import { SettingsRow, SettingsSection } from "@/components/SettingsList";
import { Toggle } from "@/components/Toggle";
import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useHomeCourt } from "@/hooks/useCourts";
import { useDiscoverMe, useSaveDiscoverSettings } from "@/hooks/useDiscover";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";

export function DiscoverSettings({ extraRows }: { extraRows?: React.ReactNode }) {
  const c = useColors();
  const router = useRouter();
  const me = useDiscoverMe();
  const save = useSaveDiscoverSettings();
  const home = useHomeCourt();

  async function setShown(shown: boolean) {
    try {
      await save.mutateAsync({ hidden: !shown });
    } catch (e) {
      Alert.alert("Couldn't save", isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Try again.");
    }
  }

  return (
    <View style={{ gap: spacing.space3 }}>
      <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ paddingHorizontal: spacing.space1 }}>
        Discover
      </Text>
      {me.isLoading ? (
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />
      ) : me.isError || !me.data ? (
        <Card style={{ gap: spacing.space3 }}>
          <Text accessibilityRole="alert">{isOfflineError(me.error) ? OFFLINE_MESSAGE : "Couldn't load your Discover settings."}</Text>
          <Button variant="secondary" label="Try again" loading={me.isRefetching} onPress={() => void me.refetch()} />
        </Card>
      ) : (
        <>
          <Card style={{ gap: spacing.space3 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3, minHeight: MIN_TAP }}>
              <Text variant="bodyStrong" style={{ flex: 1 }} importantForAccessibility="no" accessibilityElementsHidden>
                Show me in Discover
              </Text>
              <Toggle
                value={!me.data.hidden}
                onValueChange={(v) => void setShown(v)}
                disabled={save.isPending}
                accessibilityLabel="Show me in Discover"
                accessibilityHint="When this is off, players near you can't find you."
              />
            </View>
            <Text tone="inkMuted">
              When this is off, players near you can't find you, in Discover, Quick match or New message. You can still browse, message and
              play in your leagues.
            </Text>
          </Card>
          <MatchAlertsCard on={me.data.matchAlerts ?? false} title="Alerts for new open matches" />
          <SettingsSection>
            <SettingsRow
              title="Your area"
              value={me.data.area?.zip ?? me.data.homeZip ?? "Not set"}
              onPress={() => router.push("/discover/area")}
              accessibilityHint="Change the ZIP Discover searches from"
            />
            <SettingsRow
              title="Home court"
              value={home.data ? (home.data.court?.name ?? "Not set") : null}
              onPress={() => router.push({ pathname: "/courts", params: { mode: "home" } })}
              accessibilityHint="Pick from the court directory. It shows on your player card."
              last={!extraRows}
            />
            {extraRows}
          </SettingsSection>
        </>
      )}
    </View>
  );
}
