// Onboarding step 4 of 4: "What do you want to do on Ball Boi?"
// (Wave 1 review A10–A15, John, Nov 2). An optional research question:
// pick any number of the four options, or none. Skip and Continue both finish
// onboarding, and everyone lands on Home; the answer never changes where
// you go. Picks are saved for the team (users.intents, an empty list on Skip)
// and never shown back to the player.

import { useAuth, useUser } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";

import { CheckboxCard } from "@/components/CheckboxCard";
import { OnboardingStep, StepError } from "@/components/OnboardingStep";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { serverProfileKey } from "@/hooks/useServerProfile";
import { INTENTS, ONBOARDED, saveIntents, type Intent } from "@/lib/onboarding";

const QUESTION = "What do you want to do on Ball Boi?";

export default function IntentStep() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Intent[]>([]);
  /** Which button is working, so only that one shows a spinner. */
  const [busy, setBusy] = useState<"skip" | "continue" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(value: Intent) {
    setPicked((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  async function finish(answer: Intent[], button: "skip" | "continue") {
    if (!user || busy) return;
    setError(null);
    setBusy(button);
    try {
      await saveIntents(getToken, answer);
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, onboarding: ONBOARDED } });
      // The profile exists now; the gate must see that before Home opens.
      queryClient.setQueryData(serverProfileKey, true);
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <OnboardingStep
      step="intent"
      title={QUESTION}
      // In the heading, so VoiceOver reads it just before the first checkbox:
      // iOS doesn't announce a group's own label.
      reason="Pick all that apply."
      footer={
        <>
          {/* Right above the buttons: below the options it would sit under
              the footer, out of sight, exactly when someone needs it. */}
          <StepError message={error} />
          <Button
            label="Skip"
            variant="secondary"
            onPress={() => void finish([], "skip")}
            loading={busy === "skip"}
            disabled={busy === "continue"}
          />
          {/* Continue keeps the bottom spot it has on every other step. */}
          <Button
            label="Continue"
            onPress={() => void finish(picked, "continue")}
            loading={busy === "continue"}
            disabled={busy === "skip"}
          />
        </>
      }
    >
      <View accessibilityLabel={QUESTION} style={{ gap: spacing.space3 }}>
        {INTENTS.map((option) => (
          <CheckboxCard
            key={option.value}
            title={option.title}
            description={option.description}
            checked={picked.includes(option.value)}
            onPress={() => toggle(option.value)}
          />
        ))}
      </View>

      <Text variant="small" tone="inkMuted">
        This helps us improve Ball Boi. Your answer is only shared with our team.
      </Text>
    </OnboardingStep>
  );
}
