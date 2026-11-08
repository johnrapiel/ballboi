import React from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { MatchRecap } from "@workspace/api-client-react";

import { BRUSH_MARKS } from "@/components/icons/brushMarks";
import { displayScore } from "@/components/league/ScoreGrid";
import { Roundel } from "@/components/Roundel";
import { Text } from "@/components/ui";
import { radius } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { RECAP_SIZE, recapView } from "@/lib/recap";

// The match recap image (spec decision 148, John, Nov 8), 9:16 for Instagram
// Stories and texts, saved at 1080 x 1920. Always the Day look, whatever the
// phone is set to (decision 144): render it inside <DayLook>
// (components/DayLook.tsx), which gives `useColors` and the roundel the Day
// colors even in Dark Mode. Its text is fixed size (it's a picture, not a
// screen), and it carries a description of everything on it.
//
// Top to bottom: the date and league, the winner's name over "def." and the
// other side's, with the winner underlined (the winner mark, #179), the
// score from the winner's side, the court, your season record, and the
// roundel.

const UNDERLINE = BRUSH_MARKS["winner.underline"];

function Name({ names, won }: { names: string; won: boolean }) {
  const c = useColors();
  const text = (
    <Text
      variant="displayL"
      allowFontScaling={false}
      numberOfLines={2}
      adjustsFontSizeToFit
      style={{ color: won ? c.ink : c.inkMuted, fontFamily: won ? "CormorantGaramond_600SemiBold" : "CormorantGaramond_500Medium", fontSize: 40, lineHeight: 44, textAlign: "center" }}
    >
      {names}
    </Text>
  );
  if (!won) return text;
  return (
    <View style={{ paddingBottom: 8, alignSelf: "center", maxWidth: "100%" }}>
      {text}
      <Svg viewBox={UNDERLINE.viewBox} preserveAspectRatio="none" style={{ position: "absolute", left: -4, right: -4, bottom: 0, height: 10 }}>
        <Path d={UNDERLINE.d} fill={c.ink} />
      </Svg>
    </View>
  );
}

export function RecapImage({ recap }: { recap: MatchRecap }) {
  const c = useColors();
  const v = recapView(recap);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={v.description}
      collapsable={false}
      style={{
        width: RECAP_SIZE.width,
        height: RECAP_SIZE.height,
        backgroundColor: c.paper,
        paddingHorizontal: 28,
        paddingTop: 56,
        paddingBottom: 44,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <View style={{ alignItems: "center", gap: 4 }}>
        {v.date ? (
          <Text variant="small" allowFontScaling={false} style={{ color: c.inkMuted, textAlign: "center" }}>
            {v.date}
          </Text>
        ) : null}
        <Text variant="bodyStrong" allowFontScaling={false} numberOfLines={2} style={{ color: c.ink, textAlign: "center" }}>
          {recap.context}
        </Text>
      </View>

      <View style={{ alignItems: "center", gap: 10, width: "100%" }}>
        <Name names={v.top.names} won={v.top.won} />
        <Text variant="titleItalic" allowFontScaling={false} style={{ color: c.inkMuted }}>
          {v.joiner}
        </Text>
        <Name names={v.bottom.names} won={v.bottom.won} />
        <Text
          variant="score"
          allowFontScaling={false}
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ color: c.ink, marginTop: 18, fontSize: 44, lineHeight: 50, textAlign: "center" }}
        >
          {displayScore(v.score)}
        </Text>
        {recap.court ? (
          <Text variant="small" allowFontScaling={false} numberOfLines={2} style={{ color: c.inkMuted, textAlign: "center" }}>
            {recap.court}
          </Text>
        ) : null}
      </View>

      <View style={{ alignItems: "center", gap: 20 }}>
        {v.season ? (
          <View style={{ backgroundColor: c.sand, borderRadius: radius.radiusPill, paddingHorizontal: 16, paddingVertical: 6 }}>
            <Text variant="bodyStrong" allowFontScaling={false} style={{ color: c.ink }}>
              {v.season}
            </Text>
          </View>
        ) : null}
        <Roundel size={88} />
      </View>
    </View>
  );
}
