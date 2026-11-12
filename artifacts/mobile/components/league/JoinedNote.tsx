import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { Icon } from "@/components/Icon";
import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/** How long "You're in" stays before it fades (Wave 2 finding 33). */
export const JOINED_NOTE_MS = 4000;
const FADE_MS = 400;

/**
 * Wave 2 finding 33 (John, option A): after joining from an invite, the join
 * sheet closes and the league page opens with this one line at the top. It
 * fades after about 4 seconds; under Reduce Motion it just disappears.
 * VoiceOver hears "You joined [league]".
 */
export function JoinedNote({ leagueName }: { leagueName: string | null }) {
  const c = useColors();
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(true);
  const opacity = useRef(new Animated.Value(1)).current;
  const announced = useRef(false);

  // Announce once the league's name is known.
  useEffect(() => {
    if (announced.current || !leagueName) return;
    announced.current = true;
    AccessibilityInfo.announceForAccessibility(`You joined ${leagueName}`);
  }, [leagueName]);

  useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;
    const timer = setTimeout(() => {
      if (reduceMotion) {
        setShown(false);
        return;
      }
      anim = Animated.timing(opacity, { toValue: 0, duration: FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true });
      anim.start(({ finished }) => {
        if (finished) setShown(false);
      });
    }, JOINED_NOTE_MS);
    return () => {
      clearTimeout(timer);
      anim?.stop();
    };
  }, [reduceMotion, opacity]);

  if (!shown) return null;
  return (
    <Animated.View style={{ opacity }}>
      <View
        accessible
        accessibilityLabel={leagueName ? `You're in. You joined ${leagueName}.` : "You're in"}
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}
      >
        <Icon name="checkmark.circle" size={20} tintColor={c.ink} />
        <Text variant="bodyStrong">You're in</Text>
      </View>
    </Animated.View>
  );
}
