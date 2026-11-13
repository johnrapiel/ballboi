import React from "react";
import { type StyleProp, type ViewStyle } from "react-native";

import { InlineLink } from "@/components/InlineLink";
import { matchTimeLinkLabel, matchTimeLinkSpoken } from "@/lib/matchTimeLink";

// Match time as link text (Wave 2 finding 25, John, Nov 12): directly under
// the match's date line, on Match detail before play and on the league page's
// Your match card, so it sits in one place everywhere. "Set a match time"
// when none is set, "Change time" once one is. hitSlop makes it a 44pt
// target without adding space around the words (decision 192), and
// VoiceOver reads it as one link with what it does. Drawn by InlineLink,
// the same link as "Match didn't finish?" on Enter score (finding 55).

export function MatchTimeLink({
  hasTime,
  opponent,
  onPress,
  align = "center",
  style,
}: {
  hasTime: boolean;
  /** Who the match is against, for VoiceOver: "Marcus Hall". */
  opponent: string;
  onPress: () => void;
  align?: "center" | "left";
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <InlineLink
      label={matchTimeLinkLabel(hasTime)}
      accessibilityLabel={matchTimeLinkSpoken(hasTime, opponent)}
      onPress={onPress}
      align={align}
      style={style}
    />
  );
}
