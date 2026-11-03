// Replay processing card (spec: Ball Boi > After the match). No video
// playback: the card only shows where the match is between the phone and
// the replay: "Waiting for Wi-Fi · Upload now on cellular", then
// "Uploading", then "Analyzing", then ready. While the recording is still on
// the phone, Discard throws it away (coordinator note on #79, D2).

import { useAuth } from "@clerk/expo";
import { useNetworkState, NetworkStateType } from "expo-network";
import { SymbolView, type SFSymbol } from "expo-symbols";
import React, { useState } from "react";
import { AccessibilityInfo, Alert, View } from "react-native";

import { DestructiveTextButton } from "@/components/record/DestructiveTextButton";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { recordedDay, type ServerRecording } from "@/lib/recording/api";
import { useUploadOnCellular } from "@/lib/recording/prefs";
import type { QueuedRecording } from "@/lib/recording/queue";
import { discardQueued, retryUpload, uploadNowOnCellular } from "@/lib/recording/uploader";

interface Status {
  symbol: SFSymbol;
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

function serverStatus(rec: ServerRecording): Status {
  switch (rec.stage) {
    case "uploading":
      return { symbol: "arrow.up.circle", text: "Uploading" };
    case "analyzing":
      return { symbol: "hourglass", text: "Analyzing", detail: "We'll let you know when your replay is ready." };
    case "ready":
      return { symbol: "checkmark.circle", text: "Analysis done" };
    case "failed":
      return {
        symbol: "exclamationmark.circle",
        text: "Analysis is delayed",
        detail: "Your match is saved. Ball Boi keeps trying.",
      };
  }
}

function CardBody({
  opponentName,
  when,
  status,
  children,
}: {
  opponentName: string;
  when: string;
  status: Status;
  /** Extra controls under the status, like Discard. */
  children?: React.ReactNode;
}) {
  const c = useColors();
  const spoken = [`Match vs ${opponentName}`, when, status.text, status.detail].filter(Boolean).join(". ");
  return (
    <Card style={{ gap: spacing.space3 }}>
      <View accessible accessibilityLabel={spoken} style={{ gap: spacing.space2 }}>
        <View>
          <Text variant="bodyStrong">vs {opponentName}</Text>
          <Text variant="small" tone="inkMuted">
            {when}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
          <SymbolView name={status.symbol} size={18} tintColor={c.ink} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {status.text}
          </Text>
        </View>
        {status.detail ? (
          <Text variant="small" tone="inkMuted">
            {status.detail}
          </Text>
        ) : null}
      </View>
      {status.action ? <Button variant="secondary" label={status.action.label} onPress={status.action.onPress} /> : null}
      {children}
    </Card>
  );
}

/**
 * A recording still on this phone: waiting, uploading, or failed. Discard is
 * here only; once the server has the upload, the server card has no Discard.
 */
export function LocalProcessingCard({
  rec,
  onDiscarded,
}: {
  rec: QueuedRecording;
  /** matchRemoved: it was a Quick match against a placeholder, so the match went too. */
  onDiscarded?: (result: { matchRemoved: boolean }) => void;
}) {
  const onWifi = useOnWifi();
  const cellularOn = useUploadOnCellular();
  const { getToken } = useAuth();
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

  return (
    <CardBody
      opponentName={rec.opponentName}
      when={recordedDay(rec.recordedAt)}
      status={localStatus(rec, onWifi, cellularOn)}
    >
      <DestructiveTextButton
        label="Discard"
        accessibilityLabel={`Discard recording, match vs ${rec.opponentName}`}
        accessibilityHint="Asks before deleting it from this phone. It won't be analyzed."
        loading={discarding}
        onPress={confirm}
      />
    </CardBody>
  );
}

/** A recording the server has. */
export function ServerProcessingCard({ rec }: { rec: ServerRecording }) {
  return <CardBody opponentName={rec.opponentName} when={recordedDay(rec.recordedAt)} status={serverStatus(rec)} />;
}
