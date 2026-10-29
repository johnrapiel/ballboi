// Onboarding step 5: rating quiz (spec: Roles and onboarding; Ball Boi Rating).
// Pick the description that sounds most like you. It sets the Ball Boi Rating,
// the player's level for matching on the NTRP scale, labeled Self-rated.
// Results don't move it. "Link UTR instead" is shown but disabled until the UTR
// Engage integration lands.

import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";

import { OnboardingStep, StepError } from "@/components/OnboardingStep";
import { RadioCard } from "@/components/RadioCard";
import { RatingBadge } from "@/components/RatingBadge";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { QUIZ_LEVELS, formatRating, saveSelfRating } from "@/lib/onboarding";

export default function RatingStep() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function next() {
    if (rating == null) return;
    setError(null);
    setBusy(true);
    try {
      await saveSelfRating(getToken, rating);
      router.push("/onboarding/intent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingStep
      step="rating"
      title="How do you play?"
      subtitle="Pick the one that sounds most like you. It sets your Ball Boi Rating, which we use to match you with players at your level. You can change it later."
      footer={<Button label="Continue" onPress={next} loading={busy} disabled={rating == null} />}
    >
      <View accessibilityRole="radiogroup" accessibilityLabel="Your level" style={{ gap: spacing.space3 }}>
        {QUIZ_LEVELS.map((level) => (
          <RadioCard
            key={level.rating}
            title={level.title}
            description={level.description}
            meta={{ text: formatRating(level.rating), spoken: `Rating ${formatRating(level.rating)}` }}
            selected={rating === level.rating}
            onPress={() => setRating(level.rating)}
          />
        ))}
      </View>

      {rating != null ? (
        <View style={{ gap: spacing.space2 }}>
          <Text variant="label" tone="inkMuted">
            Your rating
          </Text>
          <RatingBadge rating={rating} source="self" />
        </View>
      ) : null}

      <View style={{ gap: spacing.space2 }}>
        <Button
          label="Link UTR instead"
          variant="secondary"
          disabled
          accessibilityLabel="Link UTR instead, coming soon"
        />
        <Text variant="small" tone="inkMuted">
          Coming soon. Linking UTR will set your rating and show a Verified badge.
        </Text>
      </View>

      <StepError message={error} />
    </OnboardingStep>
  );
}
