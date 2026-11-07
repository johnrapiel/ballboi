// "Something not working?" (spec decision 86, B3). A bottom sheet, by the
// sheet rule: brush title, no Cancel, drag down to close, asks before
// discarding. Pick a likely problem or "Something else" (which needs a
// description), add an optional note, Send. The app version, iPhone and iOS
// version go with it, and the match when it was opened from one. Saved on the
// server and emailed to support@ballboi.tennis (routes/feedback.ts).
//
// Opened from Settings, the ready-to-record screen, the processing card and
// the Replay screen: /feedback?source=<where>&matchId=<id>.

import { useAuth } from "@clerk/expo";
import Constants from "expo-constants";
import { useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useState } from "react";
import { AccessibilityInfo, Alert, PixelRatio, Platform, Pressable, View, useWindowDimensions } from "react-native";

import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Card, Field, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { apiErrorMessage, apiFetch, isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import {
  deviceLabel,
  FEEDBACK_PROBLEMS,
  FEEDBACK_TITLE,
  feedbackError,
  isFeedbackSource,
  MAX_NOTE,
  noteLabel,
  type FeedbackProblem,
} from "@/lib/feedback";

export default function FeedbackSheet() {
  const c = useColors();
  const { getToken } = useAuth();
  const { width, height } = useWindowDimensions();
  const params = useLocalSearchParams<{ source?: string; matchId?: string }>();
  const source = isFeedbackSource(params.source) ? params.source : "settings";
  const matchId = params.matchId && Number.isInteger(Number(params.matchId)) ? Number(params.matchId) : null;

  const [problem, setProblem] = useState<FeedbackProblem | null>(null);
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const sheet = useSheetClose((problem !== null || note.trim() !== "") && !sending);

  const formError = feedbackError(problem, note);
  const noteRequired = problem === "something_else";
  const noteError = showErrors && problem !== null && formError ? formError : null;

  const appVersion = Constants.expoConfig?.version ?? null;
  const osVersion = Platform.OS === "ios" ? String(Platform.Version) : `${Platform.OS} ${Platform.Version}`;
  const idiom = (Platform.constants as { interfaceIdiom?: string } | undefined)?.interfaceIdiom;
  const deviceModel = deviceLabel(idiom, width, height, PixelRatio.get());

  async function send() {
    if (sending) return;
    setSendError(null);
    if (formError) {
      setShowErrors(true);
      AccessibilityInfo.announceForAccessibility(formError);
      return;
    }
    setSending(true);
    try {
      const res = await apiFetch("/api/feedback", getToken, {
        method: "POST",
        body: JSON.stringify({ problem, note: note.trim() || null, source, matchId, appVersion, deviceModel, osVersion }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't send it. Try again."));
      AccessibilityInfo.announceForAccessibility("Sent. Thanks for letting us know.");
      Alert.alert("Sent", "Thanks for letting us know. We'll look into it and email you if we need more details.");
      sheet.finish();
    } catch (e) {
      setSendError(isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Couldn't send it. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <SheetBody title={FEEDBACK_TITLE} close={sheet.close}>
      <Text tone="inkMuted">Pick what happened. We'll look into it.</Text>

      <Card style={{ padding: 0, overflow: "hidden" }} accessibilityRole="radiogroup" accessibilityLabel="What's not working">
        {FEEDBACK_PROBLEMS.map((p, i) => {
          const on = problem === p.key;
          return (
            <Pressable
              key={p.key}
              onPress={() => {
                setProblem(p.key);
                setSendError(null);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={p.label}
              style={({ pressed }) => ({
                minHeight: 52,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.space3,
                paddingHorizontal: spacing.space4,
                paddingVertical: spacing.space3,
                borderBottomWidth: i === FEEDBACK_PROBLEMS.length - 1 ? 0 : 1,
                borderBottomColor: c.hairline,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text variant={on ? "bodyStrong" : "body"} style={{ flex: 1 }}>
                {p.label}
              </Text>
              {/* A check, not color, marks the pick. */}
              <View style={{ width: 20, alignItems: "center" }}>
                {on ? <SymbolView name="checkmark" size={16} tintColor={c.ink} /> : null}
              </View>
            </Pressable>
          );
        })}
      </Card>

      {problem ? (
        <Field
          label={noteLabel(problem)}
          value={note}
          onChangeText={(t) => {
            setNote(t);
            setSendError(null);
          }}
          multiline
          maxLength={MAX_NOTE}
          placeholder="What happened, and what were you doing?"
          style={{ minHeight: 96, textAlignVertical: "top", paddingTop: spacing.space3 }}
          error={!!noteError}
          hint={noteError ?? undefined}
        />
      ) : null}

      {showErrors && !problem ? (
        <Text variant="small" tone="danger" accessibilityRole="alert">
          {formError}
        </Text>
      ) : null}

      <Text variant="small" tone="inkMuted">
        {`We'll include your app version${appVersion ? ` (${appVersion})` : ""}, iPhone and iOS version${matchId != null ? ", and this match" : ""}, so we can find the problem.`}
      </Text>

      {sendError ? (
        <Text variant="small" tone="danger" accessibilityRole="alert">
          {`Not sent. ${sendError}`}
        </Text>
      ) : null}

      <Button
        label="Send"
        onPress={() => void send()}
        disabled={!problem}
        loading={sending}
        accessibilityHint={problem ? undefined : "Pick what's not working first"}
      />
    </SheetBody>
  );
}
