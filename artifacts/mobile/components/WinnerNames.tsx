import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

import { BRUSH_MARKS } from "@/components/icons/brushMarks";
import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import type { NameStyle, WinnerMark } from "@/lib/winnerMark";

const UNDERLINE = BRUSH_MARKS["winner.underline"];

/**
 * The winner's brush underline (John, Nov 8): one tapered ink stroke a little
 * below the name, stretched to its width, so it never reads as a link. Drawn
 * in scripts/design/brush-icons.py. Decorative: the row's label says who won.
 */
export function BrushUnderline({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[{ paddingBottom: 5, alignSelf: "flex-start" }, style]}>
      {children}
      <Svg
        viewBox={UNDERLINE.viewBox}
        preserveAspectRatio="none"
        style={{ position: "absolute", left: -3, right: -3, bottom: -1, height: 7 }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      >
        <Path d={UNDERLINE.d} fill={c.ink} />
      </Svg>
    </View>
  );
}

/** One player's name in the winner-mark style: bold ink and underlined, regular muted, or plain. */
export function MarkedName({ name, look, suffix }: { name: string; look: NameStyle; suffix?: React.ReactNode }) {
  const text = (
    <Text variant={look === "winner" ? "bodyStrong" : "body"} tone={look === "winner" || look === "plain" ? "ink" : "inkMuted"}>
      {name}
      {suffix}
    </Text>
  );
  return look === "winner" ? <BrushUnderline>{text}</BrushUnderline> : text;
}

/**
 * "Elena Ortiz vs. Andre Thomas" with the winner marked, and the score line
 * under it. The caller wraps it in an accessible view whose label reads
 * "[A] versus [B]. [mark.spoken]."
 */
export function WinnerNames({
  player1Name,
  player2Name,
  mark,
  line,
}: {
  player1Name: string;
  player2Name: string;
  mark: WinnerMark;
  /** Replaces the score line, for a status shown with an icon. */
  line?: React.ReactNode;
}) {
  return (
    <View style={{ gap: spacing.space1 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", columnGap: spacing.space1 + 2, rowGap: 2 }}>
        <MarkedName name={player1Name} look={mark.player1} />
        <Text tone="inkMuted">vs.</Text>
        <MarkedName name={player2Name} look={mark.player2} />
      </View>
      {line ?? (
        <Text variant="small" tone="inkMuted" style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>
          {mark.line}
        </Text>
      )}
    </View>
  );
}
