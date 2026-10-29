// Stop by pressing and holding anywhere on the mounted phone for 2 seconds
// (spec: Ball Boi > Recording, Stop). A quick touch or a ball off the fence
// does nothing. The visible Stop button is the non-gesture alternative.

import React, { useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { chrome } from "@/lib/recording/chrome";

export const HOLD_MS = 2000;

export function HoldToStop({ onStop, bottomInset }: { onStop: () => void; bottomInset: number }) {
  const reduceMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const [holding, setHolding] = useState(false);

  const begin = () => {
    setHolding(true);
    progress.setValue(0);
    if (!reduceMotion) {
      Animated.timing(progress, {
        toValue: 1,
        duration: HOLD_MS,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    }
  };
  const end = () => {
    setHolding(false);
    progress.stopAnimation();
    progress.setValue(0);
  };

  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPressIn={begin}
      onPressOut={end}
      delayLongPress={HOLD_MS}
      onLongPress={() => {
        end();
        onStop();
      }}
      // VoiceOver users stop with the visible Stop button instead.
      accessible={false}
      importantForAccessibility="no"
    >
      {holding ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: spacing.space8,
            right: spacing.space8,
            bottom: bottomInset + 140,
            padding: spacing.space4,
            borderRadius: radius.radiusLg,
            backgroundColor: chrome.scrim,
            gap: spacing.space3,
            alignItems: "center",
          }}
        >
          <Text variant="bodyStrong" style={{ color: chrome.text, textAlign: "center" }}>
            Keep holding to stop
          </Text>
          {reduceMotion ? null : (
            <View style={{ alignSelf: "stretch", height: 6, borderRadius: 3, backgroundColor: chrome.border, overflow: "hidden" }}>
              <Animated.View
                style={{
                  height: 6,
                  backgroundColor: chrome.text,
                  width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
                }}
              />
            </View>
          )}
        </View>
      ) : null}
    </Pressable>
  );
}
