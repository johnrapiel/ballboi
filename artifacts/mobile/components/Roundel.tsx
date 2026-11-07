import { Image } from "expo-image";
import React from "react";
import { View } from "react-native";

import { useColors } from "@/hooks/useColors";

/** The design system's smallest roundel, so the lettering stays readable. */
const MIN_SIZE = 40;

// Transparent traces of the painted roundel (docs/design-system/README.md,
// Logo). Day: the brushstroke in ink. Night: the brushstroke alone in white,
// with no paper fill (John, Nov 6). The painted original on paper,
// roundel.png, stays for the splash only.
const DAY = require("@/assets/images/roundel-ink.png");
const NIGHT = require("@/assets/images/roundel-white.png");

/**
 * The Ball Boi roundel: the hand-painted brush lettering and ring, on no
 * background of its own. Never recolored or outlined.
 *
 * Decorative by default: the screen's title or text carries the meaning, so
 * VoiceOver skips it. Pass `accessibilityLabel` where the roundel is the
 * brand itself (Welcome), and it reads as an image with that name.
 */
export function Roundel({ size = MIN_SIZE, accessibilityLabel }: { size?: number; accessibilityLabel?: string }) {
  const c = useColors();
  const s = Math.max(size, MIN_SIZE);
  const image = (
    <Image
      source={c.scheme === "dark" ? NIGHT : DAY}
      style={{ width: s, height: s }}
      contentFit="contain"
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? "image" : undefined}
    />
  );
  if (accessibilityLabel) return image;
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {image}
    </View>
  );
}
