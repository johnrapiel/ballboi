import { Image } from "expo-image";
import React from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { MatchRecap } from "@workspace/api-client-react";

import { BRUSH_MARKS } from "@/components/icons/brushMarks";
import { displayScore } from "@/components/league/ScoreGrid";
import { Text } from "@/components/ui";
import colors from "@/constants/colors";
import { radius } from "@/constants/tokens";
import { RECAP_SIZE, recapView } from "@/lib/recap";

// The match recap image (spec decision 148, John, Nov 8), 9:16 for Instagram
// Stories and texts, saved at 1080 x 1920. Always the Day look, whatever the
// phone is set to: it draws with the Day palette and the ink roundel
// directly, so it never follows Dark Mode. Its text is fixed size (it's a
// picture, not a screen), and it carries a description of everything on it.
//
// Top to bottom: the date and league, the winner's name over "def." and the
// other side's, with the winner underlined (the winner mark, #179), the
// score from the winner's side, the court, your season record, and the
// roundel.

const DAY = colors.light;
const ROUNDEL = require("@/assets/images/roundel-ink.png");
const UNDERLINE = BRUSH_MARKS["winner.underline"];

function Name({ names, won }: { names: string; won: boolean }) {
  const text = (
    <Text
      variant="displayL"
      allowFontScaling={false}
      numberOfLines={2}
      adjustsFontSizeToFit
      style={{ color: won ? DAY.ink : DAY.inkMuted, fontFamily: won ? "CormorantGaramond_600SemiBold" : "CormorantGaramond_500Medium", fontSize: 40, lineHeight: 44, textAlign: "center" }}
    >
      {names}
    </Text>
  );
  if (!won) return text;
  return (
    <View style={{ paddingBottom: 8, alignSelf: "center", maxWidth: "100%" }}>
      {text}
      <Svg viewBox={UNDERLINE.viewBox} preserveAspectRatio="none" style={{ position: "absolute", left: -4, right: -4, bottom: 0, height: 10 }}>
        <Path d={UNDERLINE.d} fill={DAY.ink} />
      </Svg>
    </View>
  );
}

export function RecapImage({ recap }: { recap: MatchRecap }) {
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
        backgroundColor: DAY.paper,
        paddingHorizontal: 28,
        paddingTop: 56,
        paddingBottom: 44,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <View style={{ alignItems: "center", gap: 4 }}>
        {v.date ? (
          <Text variant="small" allowFontScaling={false} style={{ color: DAY.inkMuted, textAlign: "center" }}>
            {v.date}
          </Text>
        ) : null}
        <Text variant="bodyStrong" allowFontScaling={false} numberOfLines={2} style={{ color: DAY.ink, textAlign: "center" }}>
          {recap.context}
        </Text>
      </View>

      <View style={{ alignItems: "center", gap: 10, width: "100%" }}>
        <Name names={v.top.names} won={v.top.won} />
        <Text variant="titleItalic" allowFontScaling={false} style={{ color: DAY.inkMuted }}>
          {v.joiner}
        </Text>
        <Name names={v.bottom.names} won={v.bottom.won} />
        <Text
          variant="score"
          allowFontScaling={false}
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ color: DAY.ink, marginTop: 18, fontSize: 44, lineHeight: 50, textAlign: "center" }}
        >
          {displayScore(v.score)}
        </Text>
        {recap.court ? (
          <Text variant="small" allowFontScaling={false} numberOfLines={2} style={{ color: DAY.inkMuted, textAlign: "center" }}>
            {recap.court}
          </Text>
        ) : null}
      </View>

      <View style={{ alignItems: "center", gap: 20 }}>
        {v.season ? (
          <View style={{ backgroundColor: DAY.sand, borderRadius: radius.radiusPill, paddingHorizontal: 16, paddingVertical: 6 }}>
            <Text variant="bodyStrong" allowFontScaling={false} style={{ color: DAY.ink }}>
              {v.season}
            </Text>
          </View>
        ) : null}
        <Image source={ROUNDEL} style={{ width: 88, height: 88 }} contentFit="contain" />
      </View>
    </View>
  );
}
