// Replay processing card (spec: Ball Boi > After the match). No video
// playback: the card only shows where the match is between the phone and
// the replay: "Waiting for Wi-Fi · Upload now on cellular", then
// "Uploading", then "Analyzing", then ready.

import { useNetworkState, NetworkStateType } from "expo-network";
import { SymbolView, type SFSymbol } from "expo-symbols";
import React from "react";
import { View } from "react-native";

import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { recordedDay, type ServerRecording } from "@/lib/recording/api";
import { useUploadOnCellular } from "@/lib/recording/prefs";
import type { QueuedRecording } from "@/lib/recording/queue";
import { retryUpload, uploadNowOnCellular } from "@/lib/recording/uploader";

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

function CardBody({ opponentName, when, status }: { opponentName: string; when: string; status: Status }) {
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
    </Card>
  );
}

/** A recording still on this phone. */
export function LocalProcessingCard({ rec }: { rec: QueuedRecording }) {
  const onWifi = useOnWifi();
  const cellularOn = useUploadOnCellular();
  return (
    <CardBody
      opponentName={rec.opponentName}
      when={recordedDay(rec.recordedAt)}
      status={localStatus(rec, onWifi, cellularOn)}
    />
  );
}

/** A recording the server has. */
export function ServerProcessingCard({ rec }: { rec: ServerRecording }) {
  return <CardBody opponentName={rec.opponentName} when={recordedDay(rec.recordedAt)} status={serverStatus(rec)} />;
}
