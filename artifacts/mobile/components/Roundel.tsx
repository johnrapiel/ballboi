import { Image } from "expo-image";
import React from "react";
import { View } from "react-native";

/** The design system's smallest roundel, so the lettering stays readable. */
const MIN_SIZE = 40;

/**
 * The Ball Boi roundel: navy brush lettering on its own textured paper,
 * cropped to the circle. Never recolored or outlined.
 *
 * Decorative everywhere it's used inside the app: the screen's title or
 * text carries the meaning, so VoiceOver skips it. The Welcome screen,
 * where the roundel is the brand itself, labels its own copy instead.
 */
export function Roundel({ size = MIN_SIZE }: { size?: number }) {
  const s = Math.max(size, MIN_SIZE);
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image
        source={require("@/assets/images/roundel.png")}
        style={{ width: s, height: s, borderRadius: s / 2 }}
        contentFit="cover"
      />
    </View>
  );
}
