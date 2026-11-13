// Settings, opened from Profile (Wave 1 review Q14). The two recording
// settings the spec promises "in Settings":
// - "Help Ball Boi get smarter": the training toggle (spec: Video and
//   training data), saved to the account, so it's the same on every phone.
// - "Upload on cellular": Wi-Fi only by default (spec: After the match,
//   Upload). It's about this phone's data plan, so it's saved on the phone.
// Both stick after the app closes.
// Notifications (Session G): Match day reminders (decision 127) and Show
// message previews (decision 128).
// Account (decision 138, John, Nov 8): Sign out moved here from Profile and
// sits above Delete account. Both are red and confirmed: Sign out asks
// first (and warns about recordings that haven't uploaded); Delete account
// opens the delete flow with its own confirm (Apple 5.1.1(v); finding 21).
// About (the roundel and version) moved here from Profile too.

import { useAuth } from "@clerk/expo";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetNotificationSettingsQueryKey,
  useGetNotificationSettings,
  runMatchRemindersDev,
  useUpdateNotificationSettings,
  type NotificationSettings,
} from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, View } from "react-native";

import { DiscoverSettings } from "@/components/discover/DiscoverSettings";
import { NotificationsOffBanner } from "@/components/NotificationsOffBanner";
import { TRAINING_COPY } from "@/components/record/ConsentScreen";
import { SettingsRow as ListSettingsRow, SettingsSection } from "@/components/SettingsList";
import { Roundel } from "@/components/Roundel";
import { Toggle } from "@/components/Toggle";
import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { confirmSignOut } from "@/lib/confirmSignOut";
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
  const bottom = useScreenBottomInset();
  const router = useRouter();
  const { getToken, signOut } = useAuth();
  const queryClient = useQueryClient();
  const consent = useRecordingConsent();
  const cellular = useUploadOnCellular();
  const [cellularLoaded, setCellularLoaded] = useState(false);
  const [savingTraining, setSavingTraining] = useState(false);

  useEffect(() => {
    loadUploadOnCellular().finally(() => setCellularLoaded(true));
  }, []);

  async function signOutHere() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!(await confirmSignOut(signOut, { always: true }))) return;
    router.replace("/(auth)/welcome");
  }

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
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: bottom.paddingBottom, gap: spacing.space4 }}
      scrollIndicatorInsets={bottom.scrollIndicatorInsets}
    >
      <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ paddingHorizontal: spacing.space1 }}>
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

      <NotificationSettingsSection />

      <View style={{ marginTop: spacing.space6 }}>
        <DiscoverSettings />
      </View>

      <View style={{ marginTop: spacing.space6 }}>
        <SettingsSection title="Help">
          <ListSettingsRow
            title="Something not working?"
            onPress={() => router.push({ pathname: "/feedback", params: { source: "settings" } })}
            accessibilityHint="Tell us what went wrong. It goes to Ball Boi support."
            last
          />
        </SettingsSection>
      </View>

      <View style={{ marginTop: spacing.space2 }}>
        <SettingsSection title="Account">
          <ListSettingsRow title="Sign out" destructive onPress={() => void signOutHere()} accessibilityHint="Asks you to confirm first" />
          <ListSettingsRow
            title="Delete account"
            destructive
            onPress={() => router.push("/delete-account")}
            accessibilityHint="Explains what's deleted, then asks you to confirm"
            last
          />
        </SettingsSection>
      </View>

      <View style={{ alignItems: "center", gap: spacing.space2, paddingTop: spacing.space4 }}>
        <Text variant="section" tone="inkMuted" accessibilityRole="header">
          About
        </Text>
        <Roundel size={56} />
        <Text variant="small" tone="inkMuted">
          {`Ball Boi ${Constants.expoConfig?.version ?? "1.0"}`}
        </Text>
      </View>
    </ScrollView>
  );
}

export const MATCH_REMINDERS_COPY = "At 8 AM the day before each match and 2 hours before it. A league match with no time set yet gets a heads-up on Sunday.";

export const MESSAGE_PREVIEWS_COPY = "On: message notifications show who it's from and what they said. Off: just who it's from.";

/**
 * Settings › Notifications (Session G): Match day reminders (decision 127) and
 * Show message previews (decision 128), both on by default. iOS's own Show
 * Previews setting still applies on top.
 */
function NotificationSettingsSection() {
  const c = useColors();
  const queryClient = useQueryClient();
  const settings = useGetNotificationSettings();
  const update = useUpdateNotificationSettings();
  const key = getGetNotificationSettingsQueryKey();

  async function change(next: Partial<NotificationSettings>) {
    const before = queryClient.getQueryData<NotificationSettings>(key);
    // Shown at once; put back if the server says no.
    if (before) queryClient.setQueryData<NotificationSettings>(key, { ...before, ...next });
    try {
      const saved = await update.mutateAsync({ data: next });
      queryClient.setQueryData<NotificationSettings>(key, (now) => ({ ...now, ...saved }));
    } catch (e) {
      if (before) queryClient.setQueryData(key, before);
      Alert.alert("Couldn't save", isOfflineError(e) ? OFFLINE_MESSAGE : "Check your connection and try again.");
    }
  }

  return (
    <View style={{ marginTop: spacing.space6, gap: spacing.space3 }}>
      <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ paddingHorizontal: spacing.space1 }}>
        Notifications
      </Text>
      {/* iOS notifications off: the same one line as Home, so the switch below isn't a dead end. */}
      <NotificationsOffBanner />
      {settings.isLoading ? (
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />
      ) : settings.isError || !settings.data ? (
        <Card style={{ gap: spacing.space3 }}>
          <Text accessibilityRole="alert">Couldn't load your notification settings.</Text>
          <Button variant="secondary" label="Try again" loading={settings.isRefetching} onPress={() => void settings.refetch()} />
        </Card>
      ) : (
        <>
          <SettingRow
            title="Match day reminders"
            body={MATCH_REMINDERS_COPY}
            value={settings.data.matchReminders}
            onChange={(v) => void change({ matchReminders: v })}
            disabled={update.isPending}
          />
          <SettingRow
            title="Show message previews"
            body={MESSAGE_PREVIEWS_COPY}
            value={settings.data.messagePreviews}
            onChange={(v) => void change({ messagePreviews: v })}
            disabled={update.isPending}
          />
          {settings.data.devTools ? <ReminderTestingTools /> : null}
        </>
      )}
    </View>
  );
}

/**
 * Dev servers only (never production): run the match day reminder job now, or
 * as if it were 8 AM today, to see the day-before reminder without waiting.
 * Running it twice sends nothing new (Session G acceptance 27).
 */
function ReminderTestingTools() {
  const [busy, setBusy] = useState(false);
  async function run(at: Date) {
    setBusy(true);
    try {
      const r = await runMatchRemindersDev({ at: at.toISOString() });
      Alert.alert("Reminders ran", `${r.timed} match reminder${r.timed === 1 ? "" : "s"} and ${r.nudges} Sunday nudge${r.nudges === 1 ? "" : "s"} sent.`);
    } catch {
      Alert.alert("Couldn't run", "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  const eightToday = () => {
    const d = new Date();
    d.setHours(8, 5, 0, 0);
    return d;
  };
  return (
    <Card style={{ gap: spacing.space3 }}>
      <Text variant="bodyStrong">Testing (dev server only)</Text>
      <Text tone="inkMuted">Runs the match day reminders. Each one still goes out once at most.</Text>
      <Button variant="secondary" label="Run reminders now" loading={busy} onPress={() => void run(new Date())} />
      <Button variant="secondary" label="Run as if it's 8 AM today" disabled={busy} onPress={() => void run(eightToday())} />
    </Card>
  );
}
