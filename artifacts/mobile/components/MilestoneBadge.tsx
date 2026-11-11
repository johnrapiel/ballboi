import React from "react";
import { View } from "react-native";
import Animated, { useAnimatedProps, type SharedValue } from "react-native-reanimated";
import Svg, { G, Path } from "react-native-svg";

import type { MilestoneKind } from "@workspace/api-client-react";

import { BRUSH_PATHS } from "@/components/icons/brushPaths";
import { useColors } from "@/hooks/useColors";
import { MILESTONE_ICONS } from "@/lib/milestones";

// A milestone badge (decisions 149 and 150): the design system's brush ring
// (the same strokes as BrushRing) around the milestone's brush icon, in ink.
// No canvas design exists; John reviews them in the PR. Decorative: the title
// beside it, the label under it, or the button around it carries the meaning for VoiceOver.
//
// With `draw` (0 to 1), the ring draws itself around the icon: the
// milestone moment.

const RING = "M30 90C8 80 2 52 12 30 24 8 58 2 80 14 98 26 99 58 86 76 72 94 44 98 22 90 16 87 12 83 10 78";
const RING_LENGTH = 302;
const INNER = "M18 82C6 64 8 36 28 18";
const INNER_LENGTH = 71;

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function MilestoneBadge({ kind, size, draw }: { kind: MilestoneKind; size: number; draw?: SharedValue<number> }) {
  const c = useColors();
  // Small badges get a heavier ring so it holds up next to text.
  const small = size < 40;
  const ringWidth = small ? 5.5 : 3.6;
  const innerWidth = small ? 2.6 : 1.8;
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: draw ? RING_LENGTH * (1 - draw.value) : 0 }));
  const innerProps = useAnimatedProps(() => ({ strokeDashoffset: draw ? INNER_LENGTH * (1 - Math.min(1, Math.max(0, draw.value * 1.4 - 0.4))) : 0 }));
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <Svg width={size} height={size} viewBox="-6 -6 112 112">
        <AnimatedPath
          d={RING}
          stroke={c.ink}
          strokeWidth={ringWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={[RING_LENGTH, RING_LENGTH]}
          animatedProps={ringProps}
        />
        <AnimatedPath
          d={INNER}
          stroke={c.ink}
          strokeWidth={innerWidth}
          strokeLinecap="round"
          fill="none"
          opacity={0.55}
          strokeDasharray={[INNER_LENGTH, INNER_LENGTH]}
          animatedProps={innerProps}
        />
        <G transform="translate(17 17) scale(2.75)">
          <Path d={BRUSH_PATHS[MILESTONE_ICONS[kind]]} fill={c.ink} />
        </G>
      </Svg>
    </View>
  );
}
