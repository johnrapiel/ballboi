import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { Icon } from "@/components/Icon";
import { MIN_TAP } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { copyText } from "@/lib/copy";

/** How long the check stays up after a copy (finding 22). */
export const COPIED_MS = 2000;

/**
 * The one copy control (John, Nov 11, finding 22): a plain in-page brush icon
 * (like PlainIconButton) that confirms by turning into a check for about 2
 * seconds, then turns back. No separate "Copied" line. A second tap while the
 * check is up keeps it up and restarts the timer. VoiceOver hears
 * `copiedLabel` announced, and the button reads it while the check shows.
 * Reduce Motion: the icons swap instantly; otherwise a quick cross-fade.
 * If the clipboard isn't available (an older development build), `onFail`
 * runs instead, so the caller can offer Share.
 */
export function CopyButton({
  text,
  label,
  copiedLabel,
  hint,
  onFail,
}: {
  /** What goes on the clipboard. */
  text: string;
  /** e.g. "Copy invite link". */
  label: string;
  /** e.g. "Copied invite link": announced, and the label while the check shows. */
  copiedLabel: string;
  hint?: string;
  onFail?: () => void;
}) {
  const c = useColors();
  const reduceMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fade = useRef(new Animated.Value(0)).current; // 0 = copy icon, 1 = check

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    const to = copied ? 1 : 0;
    if (reduceMotion) {
      fade.setValue(to);
      return;
    }
    const anim = Animated.timing(fade, { toValue: to, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [copied, reduceMotion, fade]);

  async function copy() {
    const ok = await copyText(text);
    if (!ok) {
      onFail?.();
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    AccessibilityInfo.announceForAccessibility(copiedLabel);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <Pressable
      onPress={copy}
      accessibilityRole="button"
      accessibilityLabel={copied ? copiedLabel : label}
      accessibilityHint={hint}
      hitSlop={4}
      style={({ pressed }) => ({
        width: MIN_TAP,
        height: MIN_TAP,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ width: 22, height: 22 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.View style={{ position: "absolute", opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
          <Icon name="doc.on.doc" size={22} tintColor={c.ink} />
        </Animated.View>
        <Animated.View style={{ position: "absolute", opacity: fade }}>
          <Icon name="checkmark" size={22} tintColor={c.ink} />
        </Animated.View>
      </View>
    </Pressable>
  );
}
