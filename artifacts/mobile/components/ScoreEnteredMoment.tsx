import * as Haptics from "expo-haptics";
import React, { useEffect } from "react";
import { AccessibilityInfo, useWindowDimensions, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

import { displayScore } from "@/components/league/ScoreGrid";
import { ResultTag, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { scoreEnteredAnnouncement } from "@/lib/milestones";

// The score-entered moment (spec: Milestone moments, decision 28 as changed
// by 80): the score settles in, then the win-loss record ticks to its new
// value, with a Success haptic and VoiceOver's "Win recorded. You're now 15
// and 6." The record is This season's, as on Profile. Levels never change
// from results. Under 1 second, plays once, never blocks input.
//
// Reduce Motion: a 200ms fade with the final state shown at once; the
// haptic still fires.

export interface Record {
  wins: number;
  losses: number;
}

const recordText = (r: Record) => `${r.wins}–${r.losses}`;

export function ScoreEnteredMoment({
  score,
  won,
  opponent,
  before,
  after,
}: {
  /** From your side, your games first. */
  score: string;
  won: boolean;
  opponent: string;
  /** This season's record before and after this result; null when it couldn't load. */
  before: Record | null;
  after: Record | null;
}) {
  const reduceMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const ticks = !!before && !!after && (before.wins !== after.wins || before.losses !== after.losses);
  const fade = useSharedValue(0);
  const settle = useSharedValue(reduceMotion ? 1 : 0);
  const tick = useSharedValue(reduceMotion || !ticks ? 1 : 0);

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    AccessibilityInfo.announceForAccessibility(scoreEnteredAnnouncement(won, before, after));
    if (reduceMotion) {
      fade.value = withTiming(1, { duration: 200 });
      return;
    }
    fade.value = withTiming(1, { duration: 160 });
    settle.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
    if (ticks) tick.value = withDelay(480, withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
    // Plays once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const whole = useAnimatedStyle(() => ({ opacity: fade.value }));
  const scoreStyle = useAnimatedStyle(() => ({ opacity: settle.value, transform: [{ scale: 1.08 - 0.08 * settle.value }] }));
  const oldRecord = useAnimatedStyle(() => ({ opacity: 1 - tick.value, transform: [{ translateY: -14 * tick.value }] }));
  const newRecord = useAnimatedStyle(() => ({ opacity: tick.value, transform: [{ translateY: 14 * (1 - tick.value) }] }));

  const spoken = scoreEnteredAnnouncement(won, before, after);
  return (
    <Animated.View style={[{ gap: spacing.space4, alignItems: "center", paddingVertical: spacing.space2 }, whole]} accessible accessibilityLabel={`${spoken} ${won ? "You won" : "You lost"} ${score} against ${opponent}.`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
        <ResultTag won={won} />
        <Text tone="inkMuted">{`vs. ${opponent}`}</Text>
      </View>
      <Animated.View style={scoreStyle}>
        <Text variant="score" numberOfLines={2} adjustsFontSizeToFit style={{ textAlign: "center" }}>
          {displayScore(score)}
        </Text>
      </Animated.View>
      {after ? (
        <View style={{ alignItems: "center", gap: 2 }}>
          <Text variant="small" tone="inkMuted">
            This season
          </Text>
          <View style={{ height: Math.ceil(36 * fontScale), minWidth: 120, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {ticks && before ? (
              <Animated.View style={[{ position: "absolute" }, oldRecord]}>
                <Text variant="scoreRow">{recordText(before)}</Text>
              </Animated.View>
            ) : null}
            <Animated.View style={[{ position: "absolute" }, newRecord]}>
              <Text variant="scoreRow">{recordText(after)}</Text>
            </Animated.View>
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}
