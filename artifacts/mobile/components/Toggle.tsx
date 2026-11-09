import * as Haptics from "expo-haptics";
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { MIN_TAP } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { KNOB_SIZE, KNOB_TRAVEL, TOGGLE_BORDER, TOGGLE_HEIGHT, TOGGLE_WIDTH, toggleLook, toggleValue } from "@/lib/toggle";

export interface ToggleProps {
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  /** Required: VoiceOver reads it with the on/off state. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The one switch used across Ball Boi. Use it instead of a raw Switch.
 *
 * Drawn from the design system tokens in the iOS switch's shape and size,
 * because iOS 26 ignores the knob color on a native switch (lib/toggle.ts):
 * - On: `ink` track, `on-ink` knob on the right.
 * - Off: `hairline-strong` border (3:1 on cards and the page), solid
 *   `ink-muted` knob on the left.
 * Day, Night and Increase Contrast come from useColors. Tap anywhere in its
 * 44pt area to switch. VoiceOver reads the label, "switch button", and On
 * or Off. Reduce Motion: the knob jumps instead of sliding.
 */
export function Toggle({ value, onValueChange, disabled, accessibilityLabel, accessibilityHint, testID, style }: ToggleProps) {
  const c = useColors();
  const reduceMotion = useReducedMotion();
  const look = toggleLook(c, value);
  const x = useRef(new Animated.Value(value ? KNOB_TRAVEL : 0)).current;

  useEffect(() => {
    const to = value ? KNOB_TRAVEL : 0;
    if (reduceMotion) {
      x.setValue(to);
      return;
    }
    const anim = Animated.timing(x, { toValue: to, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [value, reduceMotion, x]);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityValue={{ text: toggleValue(value) }}
      disabled={disabled}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        onValueChange?.(!value);
      }}
      hitSlop={{ top: (MIN_TAP - TOGGLE_HEIGHT) / 2, bottom: (MIN_TAP - TOGGLE_HEIGHT) / 2 }}
      style={[{ minWidth: MIN_TAP, minHeight: TOGGLE_HEIGHT, justifyContent: "center", opacity: disabled ? 0.45 : 1 }, style]}
    >
      <Animated.View
        style={{
          width: TOGGLE_WIDTH,
          height: TOGGLE_HEIGHT,
          borderRadius: TOGGLE_HEIGHT / 2,
          borderWidth: TOGGLE_BORDER,
          borderColor: look.border,
          backgroundColor: look.track,
          padding: (TOGGLE_HEIGHT - 2 * TOGGLE_BORDER - KNOB_SIZE) / 2,
        }}
      >
        <Animated.View
          style={{
            width: KNOB_SIZE,
            height: KNOB_SIZE,
            borderRadius: KNOB_SIZE / 2,
            backgroundColor: look.knob,
            transform: [{ translateX: x }],
          }}
        />
      </Animated.View>
    </Pressable>
  );
}
