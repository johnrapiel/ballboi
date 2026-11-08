import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getGetMyNewMilestonesQueryKey, useGetMyNewMilestones, useMarkMilestonesSeen, type Milestone } from "@workspace/api-client-react";

import { MilestoneBadge } from "@/components/MilestoneBadge";
import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { knownMilestones, MILESTONE_TITLES, milestoneAnnouncement } from "@/lib/milestones";

// The milestone moment (spec: Milestone moments; decision 149, John, Nov 8).
// The next time you open the app after earning a milestone, the badge scales
// in as a brush ring draws around it, then the title fades up: under 1
// second, with a Success haptic and VoiceOver's "Milestone: First win". It
// plays once (it's marked seen as it starts), never blocks input (the whole
// overlay ignores touches), and holds briefly before fading away. Two at once
// play one after the other.
//
// Reduce Motion: a 200ms fade with the final state shown at once; the haptic
// still fires.
//
// It sits over the tabs and plays only while they're on screen, so a
// milestone earned from a score sheet plays once the sheet closes. It checks
// on launch, when the app comes back to the front, and when the tabs regain
// focus.

const DRAW_MS = 560;
const TITLE_DELAY_MS = 520;
const TITLE_MS = 280;
const HOLD_MS = 1800;
const OUT_MS = 260;

export function MilestoneMoment({ ready }: { ready: boolean }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const q = useGetMyNewMilestones({ query: { enabled: ready, queryKey: getGetMyNewMilestonesQueryKey(), staleTime: 0 } });
  const seen = useMarkMilestonesSeen();
  const [focused, setFocused] = useState(false);
  const [current, setCurrent] = useState<Milestone | null>(null);
  const played = useRef(new Set<string>());

  const { refetch } = q;
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      if (ready) void refetch();
      return () => setFocused(false);
    }, [ready, refetch]),
  );
  useEffect(() => {
    if (!ready) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refetch();
    });
    return () => sub.remove();
  }, [ready, refetch]);

  // Next one in line, while the tabs are on screen.
  const next = knownMilestones(q.data?.milestones).find((m) => !played.current.has(m.kind));
  useEffect(() => {
    if (!focused || current || !next) return;
    played.current.add(next.kind);
    setCurrent(next);
    // Seen as it starts, so it never plays twice, even if the app closes mid-moment.
    seen.mutate({ data: { kinds: [next.kind] } });
  }, [focused, current, next, seen]);

  const shown = useSharedValue(0);
  const scale = useSharedValue(1);
  const draw = useSharedValue(1);
  const title = useSharedValue(1);

  useEffect(() => {
    if (!current) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    AccessibilityInfo.announceForAccessibility(milestoneAnnouncement(current.kind));
    const done = () => setCurrent(null);
    if (reduceMotion) {
      draw.value = 1;
      scale.value = 1;
      title.value = 1;
      shown.value = withSequence(
        withTiming(1, { duration: 200 }),
        withDelay(HOLD_MS, withTiming(0, { duration: 200 }, (fin) => {
          if (fin) runOnJS(done)();
        })),
      );
      return;
    }
    draw.value = 0;
    scale.value = 0.6;
    title.value = 0;
    shown.value = withSequence(
      withTiming(1, { duration: 120 }),
      withDelay(TITLE_DELAY_MS + TITLE_MS + HOLD_MS, withTiming(0, { duration: OUT_MS }, (fin) => {
        if (fin) runOnJS(done)();
      })),
    );
    scale.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.back(1.6)) });
    draw.value = withTiming(1, { duration: DRAW_MS, easing: Easing.out(Easing.cubic) });
    title.value = withDelay(TITLE_DELAY_MS, withTiming(1, { duration: TITLE_MS }));
  }, [current, reduceMotion, draw, scale, title, shown]);

  const card = useAnimatedStyle(() => ({ opacity: shown.value }));
  const badge = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const words = useAnimatedStyle(() => ({ opacity: title.value, transform: [{ translateY: (1 - title.value) * 6 }] }));

  if (!current) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: insets.top + 96, alignItems: "center" }}>
      <Animated.View
        // Announced once with announceForAccessibility; VoiceOver doesn't need to land on it.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          {
            alignItems: "center",
            gap: spacing.space2,
            paddingHorizontal: spacing.space6,
            paddingVertical: spacing.space6,
            backgroundColor: c.linen,
            borderRadius: radius.radiusCard,
            borderWidth: 1,
            borderColor: c.hairline,
            maxWidth: 320,
          },
          card,
        ]}
      >
        <Animated.View style={badge}>
          <MilestoneBadge kind={current.kind} size={112} draw={draw} />
        </Animated.View>
        <Animated.View style={[{ alignItems: "center", gap: 2 }, words]}>
          <Text variant="small" tone="inkMuted">
            Milestone
          </Text>
          <Text variant="title" style={{ textAlign: "center" }}>
            {MILESTONE_TITLES[current.kind]}
          </Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
