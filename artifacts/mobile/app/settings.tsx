// Settings, opened from Profile (Wave 1 review Q14).
// Discover (Wave 2): Show me in Discover, what you play, when you're usually
// free (components/discover/DiscoverSettings.tsx).
// The two recording settings the spec promises "in Settings":
// - "Help Ball Boi get smarter": the training toggle (spec: Video and
//   training data), saved to the account, so it's the same on every phone.
// - "Upload on cellular": Wi-Fi only by default (spec: After the match,
//   Upload). It's about this phone's data plan, so it's saved on the phone.
// Both stick after the app closes.

import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, View } from "react-native";

import { DiscoverSettingsSection } from "@/components/discover/DiscoverSettings";
import { TRAINING_COPY } from "@/components/record/ConsentScreen";
import { Toggle } from "@/components/Toggle";
import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { consentKey, saveTrainingEnabled, useRecordingConsent, type RecordingConsent } from "@/lib/recording/api";
import { loadUploadOnCellular, setUploadOnCellular, useUploadOnCellular } from "@/lib/recording/prefs";
import { drainQueue } from "@/lib/recording/uploader";

function SettingRow({
  title,
  body,
  value,
  onChange,
  disabled,
}: {
  title: string;
  body: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Card style={{ gap: spacing.space3 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3, minHeight: MIN_TAP }}>
        <Text variant="bodyStrong" style={{ flex: 1 }} importantForAccessibility="no" accessibilityElementsHidden>
          {title}
        </Text>
        <Toggle
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          accessibilityLabel={title}
          accessibilityHint={body}
        />
      </View>
      <Text tone="inkMuted">{body}</Text>
    </Card>
  );
}

export default function SettingsScreen() {
  const c = useColors();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const consent = useRecordingConsent();
  const cellular = useUploadOnCellular();
  const [cellularLoaded, setCellularLoaded] = useState(false);
  const [savingTraining, setSavingTraining] = useState(false);

  useEffect(() => {
    loadUploadOnCellular().finally(() => setCellularLoaded(true));
  }, []);

  async function changeTraining(on: boolean) {
    const before = queryClient.getQueryData<RecordingConsent>(consentKey);
    // Shown at once; put back if the server says no.
    if (before) queryClient.setQueryData<RecordingConsent>(consentKey, { ...before, trainingEnabled: on });
    setSavingTraining(true);
    try {
      const saved = await saveTrainingEnabled(on, getToken);
      queryClient.setQueryData(consentKey, saved);
    } catch (e) {
      if (before) queryClient.setQueryData(consentKey, before);
      Alert.alert("Couldn't save", isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Try again.");
    } finally {
      setSavingTraining(false);
    }
  }

  async function changeCellular(on: boolean) {
    await setUploadOnCellular(on);
    // Anything waiting for Wi-Fi can go now.
    if (on) drainQueue();
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, gap: spacing.space4 }}
    >
      <Text variant="label" accessibilityRole="header">
        Discover
      </Text>
      <DiscoverSettingsSection />

      <Text variant="label" accessibilityRole="header" style={{ marginTop: spacing.space4 }}>
        Ball Boi
      </Text>

      {consent.isLoading ? (
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />
      ) : consent.isError || !consent.data ? (
        <Card style={{ gap: spacing.space3 }}>
          <Text accessibilityRole="alert">
            {isOfflineError(consent.error) ? OFFLINE_MESSAGE : "Couldn't load your training setting."}
          </Text>
          <Button variant="secondary" label="Try again" loading={consent.isRefetching} onPress={() => consent.refetch()} />
        </Card>
      ) : (
        <SettingRow
          title="Help Ball Boi get smarter"
          body={TRAINING_COPY}
          value={consent.data.trainingEnabled}
          onChange={changeTraining}
          disabled={savingTraining}
        />
      )}

      {cellularLoaded ? (
        <SettingRow
          title="Upload on cellular"
          body="Off: matches upload on Wi-Fi only. On: they also upload on cellular data, which can use several GB a match."
          value={cellular}
          onChange={changeCellular}
        />
      ) : null}
    </ScrollView>
  );
}
