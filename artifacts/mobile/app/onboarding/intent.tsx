// Onboarding step 6: "What brings you here?" (spec: Roles and onboarding,
// Intent paths). The answer finishes onboarding and opens the matching place:
// - Run a league: Leagues, with the new league form open
// - Join a league: Leagues, with the invite code sheet open
// - Find matches near me: Discover
// - Record my play: Ball Boi
// Every path is a starting point, not a commitment: all tabs stay open.

import { useAuth, useUser } from "@clerk/expo";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";

import { OnboardingStep, StepError } from "@/components/OnboardingStep";
import { RadioCard } from "@/components/RadioCard";
import { Button } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { INTENTS, ONBOARDED, saveIntent, type Intent } from "@/lib/onboarding";

export default function IntentStep() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { user } = useUser();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    if (!intent || !user) return;
    setError(null);
    setBusy(true);
    try {
      await saveIntent(getToken, intent);
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, onboarding: ONBOARDED } });
      switch (intent) {
        case "run_league":
          router.replace("/(tabs)/leagues");
          router.push("/league/new");
          break;
        case "join_league":
          router.replace("/(tabs)/leagues");
          router.push("/league/join");
          break;
        case "find_matches":
          router.replace("/(tabs)/discover");
          break;
        case "record":
          router.replace("/(tabs)/ballboi");
          break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingStep
      step="intent"
      title="What brings you here?"
      subtitle="Pick one to start. Everything else is a tap away."
      footer={<Button label="Get started" onPress={finish} loading={busy} disabled={!intent} />}
    >
      <View accessibilityRole="radiogroup" accessibilityLabel="What brings you here?" style={{ gap: spacing.space3 }}>
        {INTENTS.map((option) => (
          <RadioCard
            key={option.value}
            title={option.title}
            description={option.description}
            selected={intent === option.value}
            onPress={() => setIntent(option.value)}
          />
        ))}
      </View>
      <StepError message={error} />
    </OnboardingStep>
  );
}
