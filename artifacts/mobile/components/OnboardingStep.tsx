import React from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardScreen, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { stepLabel, type Step } from "@/lib/onboarding";

/**
 * Shared layout for onboarding steps 3 to 6: step count, title, a short line
 * under it, scrolling content, and the primary action pinned at the bottom
 * (same action, same place on every step). The back button is the standard
 * header back at the top left, from the onboarding stack.
 */
export function OnboardingStep({
  step,
  title,
  subtitle,
  footer,
  children,
}: {
  step: Step;
  title: string;
  subtitle?: string;
  /** The Continue button, plus anything that sits with it. */
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardScreen>
      <ScrollView
        style={{ flex: 1, backgroundColor: c.paper }}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: spacing.space8, gap: spacing.space6 }}
      >
        <View style={{ gap: spacing.space2 }}>
          <Text variant="label" tone="inkMuted">
            {stepLabel(step)}
          </Text>
          <Text variant="displayL" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text tone="inkMuted">{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>
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
    </KeyboardScreen>
  );
}

/** Error line under a step's content. Announced when it appears. */
export function StepError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}
