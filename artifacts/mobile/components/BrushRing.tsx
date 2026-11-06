import React from "react";
import { View, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useColors } from "@/hooks/useColors";

/**
 * A hand-drawn brush circle around a short value: your rank in standings, the
 * winner's name on a score card (approved canvas, John, Nov 5). It's ink only
 * and decorative, so the text inside or the row's label carries the meaning.
 */
export function BrushRing({ children, size, style }: { children: React.ReactNode; size: number; style?: ViewStyle }) {
  const c = useColors();
  return (
    <View style={[{ minWidth: size, minHeight: size, alignItems: "center", justifyContent: "center" }, style]}>
      <Svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: "absolute", top: -4, bottom: -4, left: -6, right: -6 }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Path
          d="M30 90C8 80 2 52 12 30 24 8 58 2 80 14 98 26 99 58 86 76 72 94 44 98 22 90 16 87 12 83 10 78"
          stroke={c.ink}
          strokeWidth={2.2}
          strokeLinecap="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <Path
          d="M18 82C6 64 8 36 28 18"
          stroke={c.ink}
          strokeWidth={1.1}
          strokeLinecap="round"
          fill="none"
          opacity={0.55}
          vectorEffect="non-scaling-stroke"
        />
      </Svg>
      {children}
    </View>
  );
}
