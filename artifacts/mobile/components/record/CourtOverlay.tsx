// The court overlay on the camera while setting up: the lines the phone found,
// drawn over the preview, and a status line that says in words whether the
// court is in frame (G1: never color alone).

import { SymbolView } from "expo-symbols";
import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Line } from "react-native-svg";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import type { FrameStatus } from "@/lib/court/aim";
import type { CourtFit } from "@/lib/court/detect";
import { courtLinesInImage, isCourtShape } from "@/lib/court/geometry";
import { stillToScreen, type PhoneOrientation } from "@/lib/court/overlay";
import { chrome } from "@/lib/recording/chrome";

/** The still is 16:9, like the video. */
const STILL_ASPECT = 16 / 9;

/** Lines over the preview. Decoration only: VoiceOver reads the status instead. */
export function CourtLines({
  fit,
  locked,
  orientation,
  width,
  height,
}: {
  fit: CourtFit | null;
  locked: boolean;
  orientation: PhoneOrientation;
  width: number;
  height: number;
}) {
  if (!fit || !isCourtShape(fit.corners) || width <= 0 || height <= 0) return null;
  const lines = courtLinesInImage(fit.corners).map(([a, b]) => [
    stillToScreen(a, orientation, STILL_ASPECT, width, height),
    stillToScreen(b, orientation, STILL_ASPECT, width, height),
  ]);
  return (
    <Svg
      width={width}
      height={height}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Dark under light, so the lines show on any court. Locked lines are solid; searching lines are dashed. */}
      {lines.map(([a, b], i) => (
        <Line key={`u${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={chrome.ground} strokeOpacity={0.5} strokeWidth={5} />
      ))}
      {lines.map(([a, b], i) => (
        <Line
          key={`l${i}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={chrome.text}
          strokeWidth={locked ? 3 : 2}
          strokeDasharray={locked ? undefined : "8 6"}
        />
      ))}
    </Svg>
  );
}

export type CourtStatusText = FrameStatus | "Phone moved" | "Court not locked";

const ICON: Record<CourtStatusText, "checkmark.circle" | "viewfinder" | "exclamationmark.triangle" | "ellipsis.circle" | "questionmark.circle"> = {
  "Court locked": "checkmark.circle",
  "Court in frame": "viewfinder",
  "Court not in frame": "exclamationmark.triangle",
  "Finding the court": "ellipsis.circle",
  "Phone moved": "exclamationmark.triangle",
  "Court not locked": "questionmark.circle",
};

/** "Court locked", "Court in frame", "Court not in frame"...: an icon and the words, never color alone. */
export function CourtStatus({ status }: { status: CourtStatusText }) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={status}
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space2,
        minHeight: MIN_TAP,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space2,
        borderRadius: radius.radiusPill,
        backgroundColor: chrome.scrim,
        alignSelf: "center",
      }}
    >
      <SymbolView name={ICON[status]} size={16} tintColor={chrome.text} />
      <Text variant="bodyStrong" style={{ color: chrome.text, flexShrink: 1 }}>
        {status}
      </Text>
    </View>
  );
}
