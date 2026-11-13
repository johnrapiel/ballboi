import React, { useEffect } from "react";
import { AccessibilityInfo, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardScreen, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { stepLabel, type Step } from "@/lib/onboarding";

/** No step count in edit mode: out of layout and out of VoiceOver. */
const HIDDEN = { display: "none" } as const;

/**
 * Shared layout for onboarding steps 3 to 6: step count, title, an optional
 * one-line reason, a short line under it, scrolling content, and the primary
 * action pinned at the bottom (same action, same place on every step). The
 * back button is the standard header back at the top left, from the
 * onboarding stack.
 */
export function OnboardingStep({
  step,
  title,
  reason,
  subtitle,
  footer,
  children,
}: {
  /** The step count. Leave it out in edit mode (Profile > Edit profile). */
  step?: Step;
  title: string;
  /**
   * Why we ask, in one line, right under the title (Wave 1 review A4).
   * VoiceOver reads it with the title as one heading.
   */
  reason?: string;
  subtitle?: string;
  /** The Continue or Save button, plus anything that sits with it. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  // With a footer the list stops at its top edge; without one iOS adds the
  // home indicator (automatic insets). Either way, one gap (decision 194).
  const bottom = useScreenBottomInset({ barBelow: true });
  return (
    <KeyboardScreen>
      <ScrollView
        style={{ flex: 1, backgroundColor: c.paper }}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: bottom.paddingBottom, gap: spacing.space6 }}
      >
        <View style={{ gap: spacing.space2 }}>
          <Text variant="label" tone="inkMuted" style={step ? undefined : HIDDEN} accessibilityElementsHidden={!step}>
            {stepLabel(step)}
          </Text>
          {reason ? (
            // Tight to the title so it reads as part of the heading, with clear
            // space before the subtitle so the two muted lines don't run together.
            <View
              accessible
              accessibilityRole="header"
              accessibilityLabel={`${title}. ${reason}`}
              style={{ gap: spacing.space1, marginBottom: spacing.space2 }}
            >
              <Text variant="headingL">{title}</Text>
              <Text tone="inkMuted">{reason}</Text>
            </View>
          ) : (
            <Text variant="headingL" accessibilityRole="header">
              {title}
            </Text>
          )}
          {subtitle ? <Text tone="inkMuted">{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>
      {footer ? (
        <View
          style={{
            backgroundColor: c.paper,
            borderTopWidth: 1,
            borderTopColor: c.hairline,
            paddingHorizontal: spacing.space4,
            paddingTop: spacing.space3,
            paddingBottom: insets.bottom + spacing.space3,
            gap: spacing.space3,
          }}
        >
          {footer}
        </View>
      ) : null}
    </KeyboardScreen>
  );
}

/**
 * Error line under a step's content. Spoken when it appears: iOS ignores
 * accessibilityLiveRegion, so VoiceOver gets an explicit announcement.
 */
export function StepError({ message }: { message: string | null }) {
  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  if (!message) return null;
  return (
    <Text tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}
