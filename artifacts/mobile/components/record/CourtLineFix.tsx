// Court-line fix (spec: Ball Boi > After the match, "appears only when
// detection confidence is low: drag four handles on a still frame captured on
// the phone before upload"). Built from the W2_Calibrate artboard: the camera
// screen's dark chrome, a pill at the top, one panel of words, the primary
// action above Skip for now.
//
// The still is a photo of the court taken while setting up, not match video,
// and it never leaves the phone. Only the four corners are sent.
//
// Dragging has a non-gesture alternative: tap a handle, then move it with the
// arrow buttons. VoiceOver users get the same moves as actions on each
// handle ("Near left corner", swipe up or down for Move up, Move left...).

import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import React, { useMemo, useRef, useState } from "react";
import { AccessibilityInfo, PanResponder, Pressable, ScrollView, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Line } from "react-native-svg";

import { ChromeButton } from "@/components/record/ChromeControls";
import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { clampCorner, nudgeCorner, type Nudge } from "@/lib/court/calibration";
import { CORNER_KEYS, CORNER_NAMES, courtLinesInImage, isCourtShape, type Corners } from "@/lib/court/geometry";
import { chrome } from "@/lib/recording/chrome";

/** Room around the picture, so a corner just off the frame can still be placed. */
const MARGIN = 28;
const HANDLE = MIN_TAP;

const MOVES: { dir: Nudge; symbol: "arrow.up" | "arrow.down" | "arrow.left" | "arrow.right"; label: string }[] = [
  { dir: "left", symbol: "arrow.left", label: "left" },
  { dir: "up", symbol: "arrow.up", label: "up" },
  { dir: "down", symbol: "arrow.down", label: "down" },
  { dir: "right", symbol: "arrow.right", label: "right" },
];

export interface CourtLineFixProps {
  still: { uri: string; width: number; height: number };
  /** Where the handles start: the phone's best guess, or a typical view. */
  initial: Corners;
  onDone: (corners: Corners) => void;
  onSkip: () => void;
}

export function CourtLineFix({ still, initial, onDone, onSkip }: CourtLineFixProps) {
  const insets = useSafeAreaInsets();
  const [corners, setCornersState] = useState<Corners>(initial);
  const cornersRef = useRef<Corners>(initial);
  const [selected, setSelected] = useState(0);
  const [area, setArea] = useState({ width: 0, height: 0 });

  const setCorners = (next: Corners) => {
    cornersRef.current = next;
    setCornersState(next);
  };

  // The picture keeps the still's shape and fits the space left for it.
  const aspect = still.width / Math.max(1, still.height);
  const fitW = Math.max(0, area.width - MARGIN * 2);
  const fitH = Math.max(0, area.height - MARGIN * 2);
  const frameW = Math.min(fitW, fitH * aspect);
  const frameH = frameW / aspect;
  const frame = useRef({ w: frameW, h: frameH });
  frame.current = { w: frameW, h: frameH };

  const responders = useMemo(
    () =>
      CORNER_KEYS.map((_, i) => {
        let start = { x: 0, y: 0 };
        return PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onMoveShouldSetPanResponder: () => true,
          onPanResponderGrant: () => {
            start = cornersRef.current[i];
            setSelected(i);
          },
          onPanResponderMove: (_e, g) => {
            const { w, h } = frame.current;
            if (!w || !h) return;
            const next = [...cornersRef.current] as Corners;
            next[i] = clampCorner({ x: start.x + g.dx / w, y: start.y + g.dy / h });
            setCorners(next);
          },
          onPanResponderTerminationRequest: () => false,
        });
      }),
    [],
  );

  const valid = isCourtShape(corners);
  const lines = valid ? courtLinesInImage(corners) : [];
  const toX = (x: number) => MARGIN + x * frameW;
  const toY = (y: number) => MARGIN + y * frameH;
  const selectedName = CORNER_NAMES[CORNER_KEYS[selected]];

  function move(index: number, dir: Nudge) {
    setCorners(nudgeCorner(cornersRef.current, index, dir));
  }

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setArea({ width, height });
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: chrome.ground,
        paddingTop: insets.top + spacing.space2,
        paddingBottom: insets.bottom + spacing.space4,
        paddingHorizontal: spacing.space4,
        gap: spacing.space3,
      }}
    >
      <View style={{ alignItems: "center" }}>
        <View style={{ minHeight: MIN_TAP, paddingHorizontal: spacing.space4, borderRadius: radius.radiusPill, backgroundColor: chrome.scrim, justifyContent: "center" }}>
          <Text variant="bodyStrong" accessibilityRole="header" style={{ color: chrome.text, textAlign: "center" }}>
            Fix the court lines
          </Text>
        </View>
      </View>

      <View style={{ flex: 1, minHeight: 160, alignItems: "center", justifyContent: "center" }} onLayout={onLayout}>
        {frameW > 0 ? (
          <View style={{ width: frameW + MARGIN * 2, height: frameH + MARGIN * 2 }}>
            <Image
              source={{ uri: still.uri }}
              style={{ position: "absolute", left: MARGIN, top: MARGIN, width: frameW, height: frameH, borderRadius: radius.radiusSm }}
              contentFit="fill"
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Svg
              width={frameW + MARGIN * 2}
              height={frameH + MARGIN * 2}
              style={{ position: "absolute", left: 0, top: 0 }}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {/* Each line twice, dark under light, so it shows on any court color. */}
              {lines.map(([a, b], i) => (
                <Line key={`u${i}`} x1={toX(a.x)} y1={toY(a.y)} x2={toX(b.x)} y2={toY(b.y)} stroke={chrome.ground} strokeWidth={4} strokeOpacity={0.6} />
              ))}
              {lines.map(([a, b], i) => (
                <Line key={`l${i}`} x1={toX(a.x)} y1={toY(a.y)} x2={toX(b.x)} y2={toY(b.y)} stroke={chrome.text} strokeWidth={2} />
              ))}
            </Svg>
            {corners.map((p, i) => {
              const name = CORNER_NAMES[CORNER_KEYS[i]];
              const on = i === selected;
              return (
                <View
                  key={CORNER_KEYS[i]}
                  {...responders[i].panHandlers}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={name}
                  accessibilityHint="Drag to the corner, or swipe up or down for move actions."
                  accessibilityValue={{ text: `${Math.round(p.x * 100)} percent across, ${Math.round(p.y * 100)} percent down` }}
                  accessibilityState={{ selected: on }}
                  accessibilityActions={MOVES.map((m) => ({ name: m.dir, label: `Move ${m.label}` }))}
                  onAccessibilityAction={(e) => move(i, e.nativeEvent.actionName as Nudge)}
                  onAccessibilityTap={() => setSelected(i)}
                  style={{
                    position: "absolute",
                    left: toX(p.x) - HANDLE / 2,
                    top: toY(p.y) - HANDLE / 2,
                    width: HANDLE,
                    height: HANDLE,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {/* Ring and dot, like the canvas; the picked one is filled, so it's never color alone. */}
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      borderWidth: 2,
                      borderColor: chrome.text,
                      backgroundColor: on ? chrome.button : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: on ? chrome.onButton : chrome.text }} />
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>

      <ScrollView style={{ flexGrow: 0, maxHeight: "50%" }} contentContainerStyle={{ gap: spacing.space3 }}>
        <View style={{ backgroundColor: chrome.scrim, borderRadius: radius.radiusLg, padding: spacing.space4, gap: spacing.space2 }}>
          <Text variant="bodyStrong" style={{ color: chrome.text }} accessibilityLiveRegion="polite">
            {selectedName}
          </Text>
          <Text variant="small" style={{ color: chrome.text }}>
            Ball Boi wasn't sure where the court is. Drag each circle to where a baseline meets a singles sideline, so
            it can measure speed and placement.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.space2 }}>
            {MOVES.map((m) => (
              <Pressable
                key={m.dir}
                accessibilityRole="button"
                accessibilityLabel={`Move ${selectedName.toLowerCase()} ${m.label}`}
                onPress={() => move(selected, m.dir)}
                hitSlop={2}
                style={({ pressed }) => ({
                  width: MIN_TAP,
                  height: MIN_TAP,
                  borderRadius: MIN_TAP / 2,
                  borderWidth: 1,
                  borderColor: chrome.border,
                  backgroundColor: chrome.scrim,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <SymbolView name={m.symbol} size={16} tintColor={chrome.text} />
              </Pressable>
            ))}
          </View>
          {!valid ? (
            <View style={{ flexDirection: "row", gap: spacing.space2, alignItems: "flex-start" }} accessible>
              <SymbolView name="exclamationmark.triangle" size={16} tintColor={chrome.text} style={{ marginTop: 2 }} />
              <Text variant="small" style={{ color: chrome.text, flex: 1 }} accessibilityLiveRegion="polite">
                These corners don't make a court yet. Put each circle on its own corner.
              </Text>
            </View>
          ) : null}
        </View>
        <ChromeButton
          label="Save court lines"
          disabled={!valid}
          accessibilityHint={valid ? undefined : "Put each circle on its own corner first."}
          onPress={() => {
            AccessibilityInfo.announceForAccessibility("Court lines saved");
            onDone(cornersRef.current);
          }}
        />
        <ChromeButton
          variant="secondary"
          label="Skip for now"
          accessibilityHint="Ball Boi finds the court in the video instead."
          onPress={onSkip}
        />
      </ScrollView>
    </View>
  );
}
