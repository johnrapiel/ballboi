import React, { useRef, useState } from "react";
import { PanResponder, View, type LayoutChangeEvent } from "react-native";

import { MIN_TAP, radius as radii } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { MAX_RADIUS, MIN_RADIUS, clampRadius } from "@/lib/discover";

const THUMB = 28;

/**
 * Distance from 1 to 30 miles. Drag the thumb or tap the track. VoiceOver
 * adjusts it a mile at a time (swipe up or down), and the typed field beside
 * it is the non-drag way (WCAG 2.5.7). Built in JS: Session F adds nothing
 * native.
 */
export function RadiusSlider({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const c = useColors();
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const fromX = (x: number) => {
    const w = widthRef.current - THUMB;
    if (w <= 0) return MIN_RADIUS;
    const t = Math.min(1, Math.max(0, (x - THUMB / 2) / w));
    return clampRadius(MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => onChangeRef.current(fromX(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => onChangeRef.current(fromX(e.nativeEvent.locationX)),
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };

  const t = (value - MIN_RADIUS) / (MAX_RADIUS - MIN_RADIUS);
  const left = Math.max(0, (width - THUMB) * t);

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: MIN_RADIUS, max: MAX_RADIUS, now: value, text: `${value} mile${value === 1 ? "" : "s"}` }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "increment") onChange(clampRadius(value + 1));
        if (e.nativeEvent.actionName === "decrement") onChange(clampRadius(value - 1));
      }}
      onLayout={onLayout}
      {...pan.panHandlers}
      style={{ height: MIN_TAP, justifyContent: "center" }}
    >
      <View style={{ height: 4, borderRadius: radii.radiusPill, backgroundColor: c.hairlineStrong, marginHorizontal: THUMB / 2 }} />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: THUMB / 2,
          width: Math.max(0, left),
          height: 4,
          borderRadius: radii.radiusPill,
          backgroundColor: c.ink,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left,
          width: THUMB,
          height: THUMB,
          borderRadius: THUMB / 2,
          backgroundColor: c.linen,
          borderWidth: 2,
          borderColor: c.ink,
        }}
      />
    </View>
  );
}
