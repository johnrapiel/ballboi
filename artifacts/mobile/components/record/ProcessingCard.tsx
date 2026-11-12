// Replay processing card (spec: Ball Boi > After the match). No video
// playback: the card only shows where the match is between the phone and
// the replay: "Waiting for Wi-Fi · Upload now on cellular", then
// "Uploading", then "Analyzing", then "Replay is ready". While the recording
// is still on the phone, Discard throws it away (coordinator note on #79, D2).
//
// Wave 1 review:
// - D5: the ready card opens the Replay screen.
// - D12: while analyzing, no promise of a notification.
// - Q16: a failed analysis says so plainly, with a short reason and Remove.
//   It never says Ball Boi keeps trying.
// - D18: a recording the server is still waiting for, whose video isn't on
//   this phone any more (a reinstall), says it didn't upload and offers Remove.
// - D6: a Quick match with no score offers Enter score.
//
// Card actions (John, Nov 10, option B, decision 178): the card shows only
// the opponent, the date, the status and its reason. Report a problem and
// Remove (or Discard, while the video is still on the phone) live behind a
// More button at the top right, in a bottom sheet (decision 186).
// Steps that move the match on (Try again, Upload now
// on cellular, Enter score) stay on the card as buttons.

import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { useNetworkState, NetworkStateType } from "expo-network";
import { useRouter } from "expo-router";
import { Icon, type IconName } from "@/components/Icon";
import React, { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, Pressable, View } from "react-native";

import { useActionSheet, type SheetRow } from "@/components/ActionSheet";
import { PlainIconButton } from "@/components/Choice";
import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import {
  recordedDay,
  recordingsKey,
  removeRecording,
  todaysMatchesKey,
  type ServerRecording,
} from "@/lib/recording/api";
import { useUploadOnCellular } from "@/lib/recording/prefs";
import type { QueuedRecording } from "@/lib/recording/queue";
import { discardQueued, retryUpload, uploadNowOnCellular } from "@/lib/recording/uploader";

/** Shown while analyzing, on the card and on the Replay screen (D12). */
export const ANALYZING_DETAIL = "Check back here for your replay.";
/**
 * After upload, while no stat has passed its accuracy bar (spec decision 88,
 * B5). Replaces "Analyzing" and "Replay is ready" until stats exist.
 */
export const UPLOADED_TITLE = "Uploaded";
export const UPLOADED_DETAIL =
  "Thanks. Ball Boi's shot tracking is still learning, so stats and your replay come in a later update. Your match is saved.";
/** Shown when analysis can't finish, on the card and on the Replay screen (Q16). */
export const FAILED_TITLE = "Ball Boi couldn't analyze this match";

interface Status {
  symbol: IconName;
  text: string;
  detail?: string;
  action?: { label: string; onPress: () => void };
}

function useOnWifi(): boolean | null {
  const net = useNetworkState();
  if (net.type == null) return null;
  return net.type === NetworkStateType.WIFI || net.type === NetworkStateType.ETHERNET;
}

function localStatus(rec: QueuedRecording, onWifi: boolean | null, cellularOn: boolean): Status {
  if (rec.state === "uploading") return { symbol: "arrow.up.circle", text: "Uploading" };
  if (rec.state === "failed") {
    return {
      symbol: "exclamationmark.circle",
      text: "Upload didn't finish",
      detail: "Your match is still on this phone. It tries again on its own.",
      action: { label: "Try again", onPress: () => retryUpload(rec.id) },
    };
  }
  if (onWifi === false && !cellularOn && !rec.allowCellular) {
    return {
      symbol: "wifi",
      text: "Waiting for Wi-Fi",
      action: { label: "Upload now on cellular", onPress: () => uploadNowOnCellular(rec.id) },
    };
  }
  return { symbol: "clock", text: "Waiting to upload" };
}

function serverStatus(rec: ServerRecording, lost: boolean): Status {
  if (lost) {
    return {
      symbol: "exclamationmark.circle",
      text: "Didn't upload",
      detail: "The video isn't on this phone anymore, so Ball Boi can't analyze this match.",
    };
  }
  if (rec.stillLearning && (rec.stage === "analyzing" || rec.stage === "ready")) {
    return { symbol: "checkmark.circle", text: UPLOADED_TITLE, detail: UPLOADED_DETAIL };
  }
  switch (rec.stage) {
    case "uploading":
      return { symbol: "arrow.up.circle", text: "Uploading" };
    case "analyzing":
      return { symbol: "hourglass", text: "Analyzing", detail: ANALYZING_DETAIL };
    case "ready":
      return { symbol: "checkmark.circle", text: "Replay is ready" };
    case "failed":
      return {
        symbol: "exclamationmark.circle",
        text: FAILED_TITLE,
        detail: rec.failedReason ?? "Something went wrong on our side.",
      };
  }
}

function CardBody({
  opponentName,
  when,
  status,
  onPress,
  pressHint,
  more,
  children,
}: {
  opponentName: string;
  when: string;
  status: Status;
  /**
   * The More button's sheet. `busy` names what's running ("Removing"): the
   * button turns into a spinner with that label until it finishes.
   */
  more: { onPress: () => void; hint: string; busy?: string };
  /** Makes the top of the card a button, like opening the replay. */
  onPress?: () => void;
  pressHint?: string;
  /** Extra buttons under the status, like Enter score. */
  children?: React.ReactNode;
}) {
  const c = useColors();
  const spoken = [`Match vs ${opponentName}`, when, status.text, status.detail].filter(Boolean).join(". ");
  const summary = (
    <>
      {/* Leaves room for the More button at the top right. */}
      <View style={{ paddingEnd: MIN_TAP }}>
        <Text variant="bodyStrong">vs {opponentName}</Text>
        <Text variant="small" tone="inkMuted">
          {when}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
        <Icon name={status.symbol} size={18} tintColor={c.ink} />
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {status.text}
        </Text>
        {onPress ? <Icon name="chevron.right" size={14} tintColor={c.ink} /> : null}
      </View>
      {status.detail ? (
        <Text variant="small" tone="inkMuted">
          {status.detail}
        </Text>
      ) : null}
    </>
  );
  return (
    <Card style={{ gap: spacing.space3, position: "relative" }}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={spoken}
          accessibilityHint={pressHint}
          style={({ pressed }) => ({ gap: spacing.space2, opacity: pressed ? 0.7 : 1 })}
        >
          {summary}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={spoken} style={{ gap: spacing.space2 }}>
          {summary}
        </View>
      )}
      {/* After the summary, so VoiceOver reaches it right after the card's details. */}
      <View style={{ position: "absolute", top: MORE_INSET, end: MORE_INSET }}>
        {more.busy ? (
          <View
            accessible
            accessibilityLabel={more.busy}
            accessibilityState={{ busy: true }}
            style={{ width: MIN_TAP, height: MIN_TAP, alignItems: "center", justifyContent: "center" }}
          >
            <ActivityIndicator color={c.ink} />
          </View>
        ) : (
          <PlainIconButton
            symbol="ellipsis"
            size={MORE_ICON}
            label={`More options for your match with ${opponentName}`}
            hint={more.hint}
            onPress={more.onPress}
          />
        )}
      </View>
      {status.action ? <Button variant="secondary" label={status.action.label} onPress={status.action.onPress} /> : null}
      {children}
    </Card>
  );
}

/** The brush ellipsis, drawn at the plain icon button's default size. */
const MORE_ICON = 22;
/** Sits the icon inside the card's padding while keeping the full 44pt target. */
const MORE_INSET = spacing.space4 - (MIN_TAP - MORE_ICON) / 2;

/** Report a problem on a card (was "Something not working?", B3), with the match attached. */
function useReportProblem() {
  const router = useRouter();
  return (matchId: number) =>
    router.push({ pathname: "/feedback", params: { source: "processing", matchId: String(matchId) } });
}

/**
 * The card's More options in a bottom sheet (decision 186): Report a problem,
 * then the red remove action if there is one, which confirms with an alert.
 * Render `element` with the card.
 */
function useMoreOptions(opponentName: string) {
  const sheet = useActionSheet();
  const open = (report: () => void, destructive?: { label: string; run: () => void }) => {
    const rows: SheetRow[] = [{ label: "Report a problem", icon: "exclamationmark.circle", onPress: report }];
    if (destructive) rows.push({ label: destructive.label, icon: "trash", destructive: true, onPress: destructive.run });
    sheet.show({ title: `Recording vs. ${opponentName}`, titleHasName: true, rows });
  };
  return { open, element: sheet.element };
}

/** Opens the score prompt from a card, for a Quick match whose score is still missing (D6). */
function useEnterScore() {
  const router = useRouter();
  return (p: { matchId: number; opponentName: string; recId?: string }) =>
    router.push({
      pathname: "/record/score/[matchId]",
      params: { matchId: String(p.matchId), opponent: p.opponentName, fromCard: "1", ...(p.recId ? { rec: p.recId } : {}) },
    });
}

/**
 * A recording still on this phone: waiting, uploading, or failed. Discard is
 * here only; once the server has the upload, the server card has no Discard.
 */
export function LocalProcessingCard({
  rec,
  onDiscarded,
  showEnterScore = true,
}: {
  rec: QueuedRecording;
  /** matchRemoved: it was a Quick match against a placeholder, so the match went too. */
  onDiscarded?: (result: { matchRemoved: boolean }) => void;
  /** Off on the score prompt itself. */
  showEnterScore?: boolean;
}) {
  const onWifi = useOnWifi();
  const cellularOn = useUploadOnCellular();
  const { getToken } = useAuth();
  const enterScore = useEnterScore();
  const report = useReportProblem();
  const more = useMoreOptions(rec.opponentName);
  const [discarding, setDiscarding] = useState(false);

  const discard = async () => {
    setDiscarding(true);
    try {
      const result = await discardQueued(rec.id, getToken);
      AccessibilityInfo.announceForAccessibility("Recording discarded");
      onDiscarded?.(result);
    } catch (e) {
      Alert.alert("Couldn't discard", e instanceof Error ? e.message : "Try again.");
      setDiscarding(false);
    }
  };

  const confirm = () =>
    Alert.alert("Discard this recording?", "It won't be analyzed.", [
      { text: "Cancel", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: discard },
    ]);

  // leagueId is null for a Quick match; older queue entries don't know (undefined), so they don't offer it.
  const needsScore = showEnterScore && rec.leagueId === null && !rec.scoreEntered;

  return (
    <>
      {more.element}
      <CardBody
        opponentName={rec.opponentName}
        when={recordedDay(rec.recordedAt)}
        status={localStatus(rec, onWifi, cellularOn)}
        more={{
          busy: discarding ? "Discarding" : undefined,
          hint: "Report a problem or discard this recording.",
          onPress: () => more.open(() => report(rec.matchId), { label: "Discard recording", run: confirm }),
        }}
      >
        {needsScore ? (
          <Button
            variant="secondary"
            label="Enter score"
            accessibilityLabel={`Enter score, match vs ${rec.opponentName}`}
            onPress={() => enterScore({ matchId: rec.matchId, opponentName: rec.opponentName, recId: rec.id })}
          />
        ) : null}
      </CardBody>
    </>
  );
}

/**
 * A recording the server has. `lost`: the server is still waiting for the
 * video, and it isn't on this phone (D18).
 */
export function ServerProcessingCard({ rec, lost = false }: { rec: ServerRecording; lost?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const enterScore = useEnterScore();
  const report = useReportProblem();
  const more = useMoreOptions(rec.opponentName);
  const [removing, setRemoving] = useState(false);
  const status = serverStatus(rec, lost);
  const canRemove = lost || rec.stage === "failed";
  const needsScore = rec.leagueId === null && !rec.scoreEntered && !lost;
  const ready = rec.stage === "ready" && !lost && !rec.stillLearning;

  const remove = async () => {
    setRemoving(true);
    try {
      await removeRecording(rec.sessionId, getToken);
      AccessibilityInfo.announceForAccessibility("Recording removed");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: recordingsKey }),
        queryClient.invalidateQueries({ queryKey: todaysMatchesKey }),
      ]);
    } catch (e) {
      Alert.alert("Couldn't remove it", e instanceof Error ? e.message : "Try again.");
      setRemoving(false);
    }
  };

  const confirm = () =>
    Alert.alert(
      "Remove this recording?",
      rec.recordedByYou ? "It's removed for both players." : "It's removed from your recordings.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: remove },
      ],
    );

  return (
    <>
      {more.element}
      <CardBody
        opponentName={rec.opponentName}
        when={recordedDay(rec.recordedAt)}
        status={status}
        onPress={
          ready ? () => router.push({ pathname: "/replay/[matchId]", params: { matchId: String(rec.matchId) } }) : undefined
        }
        pressHint={ready ? "Opens the replay" : undefined}
        more={{
          busy: removing ? "Removing" : undefined,
          hint: canRemove ? "Report a problem or remove this recording." : "Report a problem with this recording.",
          onPress: () => more.open(() => report(rec.matchId), canRemove ? { label: "Remove recording", run: confirm } : undefined),
        }}
      >
        {needsScore ? (
          <Button
            variant="secondary"
            label="Enter score"
            accessibilityLabel={`Enter score, match vs ${rec.opponentName}`}
            onPress={() => enterScore({ matchId: rec.matchId, opponentName: rec.opponentName })}
          />
        ) : null}
      </CardBody>
    </>
  );
}
