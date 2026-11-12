import React from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";

import { TextLink } from "@/components/ui";
import { matchTimeLinkLabel, matchTimeLinkSpoken } from "@/lib/matchTimeLink";
import { textTapSlop } from "@/lib/tapTarget";

// Match time as link text (Wave 2 finding 25, John, Nov 12): directly under
// the match's date line, on Match detail before play and on the league page's
// Your match card, so it sits in one place everywhere. "Set a match time"
// when none is set, "Change time" once one is. hitSlop makes it a 44pt
// target without adding space around the words (decision 192), and
// VoiceOver reads it as one link with what it does.

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
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={matchTimeLinkSpoken(hasTime, opponent)}
      hitSlop={textTapSlop("body")}
      style={({ pressed }) => [
        {
          justifyContent: "center",
          alignSelf: align === "center" ? "center" : "flex-start",
          maxWidth: "100%",
          opacity: pressed ? 0.6 : 1,
        },
        style,
      ]}
    >
      {/* The words take the same press; the Pressable is the one VoiceOver link. */}
      <TextLink onPress={onPress} accessible={false} style={{ textAlign: align === "center" ? "center" : "left" }}>
        {matchTimeLinkLabel(hasTime)}
      </TextLink>
    </Pressable>
  );
}
