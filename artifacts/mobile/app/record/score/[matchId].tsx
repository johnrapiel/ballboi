// Post-stop score prompt (spec: Ball Boi > After the match): "Score prompt at
// stop posts to standings right away (ratings and stats only if the match is
// in its grace period); the first score entered stands." Under it, the
// recording's processing card, so it's clear the match is saved.

import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useState } from "react";
import { AccessibilityInfo, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LocalProcessingCard } from "@/components/record/ProcessingCard";
import { Button, Card, Field, KeyboardScreen, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import {
  isTiebreakSet,
  recordingsKey,
  scoreString,
  submitScore,
  todaysMatchesKey,
  type SetEntry,
} from "@/lib/recording/api";
import { useQueuedRecording } from "@/lib/recording/queue";
import { STOP_MESSAGES, type StopReason } from "@/lib/recording/safety";

const MAX_SETS = 5;
const empty = (): SetEntry => ({ mine: "", theirs: "", tiebreak: "" });
const digits = (v: string) => v.replace(/[^0-9]/g, "").slice(0, 2);

export default function ScorePromptScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    matchId: string;
    opponent?: string;
    league?: string;
    rec?: string;
    stopped?: string;
  }>();
  const matchId = Number(params.matchId);
  const leagueId = params.league ? Number(params.league) : null;
  const opponent = params.opponent ?? "Opponent";
  const rec = useQueuedRecording(params.rec ?? null);
  const stopped = params.stopped as Exclude<StopReason, "user"> | undefined;

  const [sets, setSets] = useState<SetEntry[]>([empty(), empty()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"saved" | "already" | null>(null);

  const score = scoreString(sets);

  function update(i: number, patch: Partial<SetEntry>) {
    setSets((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  async function save() {
    if (!score) return;
    setSaving(true);
    setError(null);
    const result = await submitScore({ matchId, leagueId }, score, getToken).catch(() => ({
      ok: false as const,
      alreadyEntered: false,
      error: "Couldn't save the score. Check your connection and try again.",
    }));
    setSaving(false);
    if (result.ok || result.alreadyEntered) {
      setDone(result.ok ? "saved" : "already");
      queryClient.invalidateQueries({ queryKey: todaysMatchesKey });
      queryClient.invalidateQueries({ queryKey: recordingsKey });
      AccessibilityInfo.announceForAccessibility(result.ok ? `Score saved, ${score}` : "A score is already in for this match");
    } else {
      setError(result.error);
    }
  }

  const finish = () => router.back();

  return (
    <KeyboardScreen>
      <ScrollView
        style={{ flex: 1, backgroundColor: c.paper }}
        contentContainerStyle={{ padding: spacing.space4, gap: spacing.space6 }}
        keyboardShouldPersistTaps="handled"
      >
        {stopped && STOP_MESSAGES[stopped] ? (
          <Card accessible style={{ flexDirection: "row", gap: spacing.space2, alignItems: "flex-start" }}>
            <SymbolView name="exclamationmark.triangle" size={18} tintColor={c.ink} style={{ marginTop: 2 }} />
            <Text style={{ flex: 1 }}>{STOP_MESSAGES[stopped]}</Text>
          </Card>
        ) : null}

        {done ? (
          <View style={{ gap: spacing.space2 }} accessible>
            <Text variant="title" accessibilityRole="header">
              {done === "saved" ? "Score saved" : "Score already in"}
            </Text>
            <Text tone="inkMuted">
              {done === "saved"
                ? `${score} vs ${opponent}.`
                : "Your opponent entered it first. The first score entered stands."}
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing.space4 }}>
            <View style={{ gap: spacing.space1 }}>
              <Text variant="title" accessibilityRole="header">
                How did it go?
              </Text>
              <Text tone="inkMuted">Enter the score from your side, vs {opponent}. The first score entered stands.</Text>
            </View>

            {sets.map((s, i) => (
              <Card key={i} style={{ gap: spacing.space3 }}>
                <Text variant="label" accessibilityRole="header">
                  Set {i + 1}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.space3 }}>
                  <View style={{ flex: 1, minWidth: 120 }}>
                    <Field
                      label="You"
                      value={s.mine}
                      onChangeText={(v) => update(i, { mine: digits(v) })}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 120 }}>
                    <Field
                      label={opponent}
                      value={s.theirs}
                      onChangeText={(v) => update(i, { theirs: digits(v) })}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                  </View>
                </View>
                {isTiebreakSet(s) ? (
                  <Field
                    label="Tiebreak, loser's points"
                    hint="Optional. For 7-6(4), enter 4."
                    value={s.tiebreak}
                    onChangeText={(v) => update(i, { tiebreak: digits(v) })}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                ) : null}
              </Card>
            ))}

            {sets.length < MAX_SETS ? (
              <Button
                variant="secondary"
                label="Add a set"
                accessibilityHint="For a third set or a match tiebreak, like 10-7"
                onPress={() => setSets((prev) => [...prev, empty()])}
              />
            ) : null}

            {error ? (
              <Text tone="danger" accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
          </View>
        )}

        {rec ? (
          <View style={{ gap: spacing.space2 }}>
            <Text variant="label" accessibilityRole="header">
              Your recording
            </Text>
            <LocalProcessingCard rec={rec} />
          </View>
        ) : (
          <Text tone="inkMuted">Your recording is uploaded. Ball Boi is analyzing it.</Text>
        )}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: spacing.space4,
          paddingTop: spacing.space3,
          paddingBottom: insets.bottom + spacing.space4,
          gap: spacing.space3,
          backgroundColor: c.paper,
          borderTopWidth: 1,
          borderTopColor: c.hairline,
        }}
      >
        {done ? (
          <Button label="Done" onPress={finish} />
        ) : (
          <>
            <Button label="Save score" onPress={save} loading={saving} disabled={!score} />
            <Button variant="secondary" label="Not now" accessibilityHint="You can enter the score later" onPress={finish} />
          </>
        )}
      </View>
    </KeyboardScreen>
  );
}
