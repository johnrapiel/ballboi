// First-recording consent (spec: Ball Boi > Recording, Video and training
// data). Shown once per account before the camera opens. Covers recording
// other players, audio used only for analysis, and the training toggle,
// which is on by default.

import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { SymbolView, type SFSymbol } from "expo-symbols";
import React, { useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { consentKey, saveRecordingConsent } from "@/lib/recording/api";

/** Spec wording for the training toggle. Keep word for word. */
export const TRAINING_COPY =
  "We use match video to train our shot tracking. Your personal information is never shared or sold. Turn this off anytime in Settings.";

function Point({ symbol, title, body }: { symbol: SFSymbol; title: string; body: string }) {
  const c = useColors();
  return (
    <View accessible accessibilityLabel={`${title}. ${body}`} style={{ flexDirection: "row", gap: spacing.space3 }}>
      <SymbolView name={symbol} size={22} tintColor={c.ink} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: spacing.space1 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text tone="inkMuted">{body}</Text>
      </View>
    </View>
  );
}

export function ConsentScreen({ onAgree, onCancel }: { onAgree: () => void; onCancel: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [training, setTraining] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveRecordingConsent(training, getToken);
      queryClient.setQueryData(consentKey, saved);
      onAgree();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your choice. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.space6,
          paddingBottom: spacing.space6,
          paddingHorizontal: spacing.space4,
          gap: spacing.space6,
        }}
      >
        <Text variant="title" accessibilityRole="header">
          Before your first recording
        </Text>

        <View style={{ gap: spacing.space4 }}>
          <Point
            symbol="person.2"
            title="You're filming other players"
            body="Ball Boi films the whole court, including your opponent. Let everyone in the match know before you start."
          />
          <Point
            symbol="waveform"
            title="Audio is for analysis only"
            body="The microphone listens for the sound of the ball being hit. Audio is never played back and is deleted after your match is analyzed."
          />
          <Point
            symbol="eye.slash"
            title="Video is never shown in the app"
            body="Ball Boi turns your match into stats and a simulated replay. The video is deleted after analysis unless it's used for training."
          />
        </View>

        <Card style={{ gap: spacing.space3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3, minHeight: MIN_TAP }}>
            <Text variant="bodyStrong" style={{ flex: 1 }} importantForAccessibility="no" accessibilityElementsHidden>
              Help Ball Boi get smarter
            </Text>
            <Switch
              value={training}
              onValueChange={setTraining}
              accessibilityLabel="Help Ball Boi get smarter"
              accessibilityHint={TRAINING_COPY}
              trackColor={{ true: c.ink, false: c.hairlineStrong }}
              ios_backgroundColor={c.hairlineStrong}
            />
          </View>
          <Text tone="inkMuted">{TRAINING_COPY}</Text>
          <Text variant="small" tone="inkMuted">
            A match is used for training only if every player leaves this on. Players who haven't joined Ball Boi are never
            included.
          </Text>
        </Card>

        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: spacing.space4,
          paddingTop: spacing.space3,
          paddingBottom: insets.bottom + spacing.space4,
          gap: spacing.space3,
          borderTopWidth: 1,
          borderTopColor: c.hairline,
          backgroundColor: c.paper,
        }}
      >
        <Button label="Continue" loading={saving} onPress={agree} />
        <Button variant="secondary" label="Not now" onPress={onCancel} disabled={saving} />
      </View>
    </View>
  );
}
