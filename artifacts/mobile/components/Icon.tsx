import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

import { BRUSH_PATHS, type IconName } from "@/components/icons/brushPaths";

export type { IconName };

/**
 * Every icon in Ball Boi is hand-drawn (John, Nov 7, 2026): the brush set that
 * matches the tab bar. Never use SF Symbols (expo-symbols) or an icon library.
 * Names follow SF Symbols so meanings stay familiar. To add one, draw it in
 * scripts/design/brush-icons.py and re-run the script.
 *
 * Decorative by default, like SymbolView: the control or text beside it
 * carries the meaning for VoiceOver.
 */
export function Icon({
  name,
  size = 24,
  tintColor,
  style,
}: {
  name: IconName;
  size?: number;
  tintColor: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d={BRUSH_PATHS[name]} fill={tintColor} />
      </Svg>
    </View>
  );
}
