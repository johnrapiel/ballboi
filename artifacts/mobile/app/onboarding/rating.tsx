// Onboarding step 5: rating quiz (spec: Roles and onboarding; Ball Boi Rating).
// Pick the description that sounds most like you. It sets the Ball Boi Rating,
// the player's level for matching on the NTRP scale, labeled Self-rated.
// Results don't move it. "Link UTR instead" is shown but disabled until the UTR
// Engage integration lands.
//
// Also Profile > Edit profile > Your level (mode="edit"): prefilled, and Save
// posts the same Self-rated level. A Verified (UTR) level can't be changed
// here, so "Linked to UTR" shows instead of the quiz.

import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { OnboardingStep, StepError } from "@/components/OnboardingStep";
import { EditLoading } from "@/components/profile/EditLoading";
import { RadioCard } from "@/components/RadioCard";
import { RatingBadge } from "@/components/RatingBadge";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { QUIZ_LEVELS, fetchProfile, formatRating, saveSelfRating, type FormMode } from "@/lib/onboarding";

export default function RatingStep({ mode = "onboarding" }: { mode?: FormMode }) {
  const editing = mode === "edit";
  const router = useRouter();
  const { getToken } = useAuth();
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit mode starts from the saved level, and Save waits until it has loaded.
  const [verified, setVerified] = useState(false);
  const [loaded, setLoaded] = useState(!editing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!editing) return;
    setLoadError(null);
    fetchProfile(getToken)
      .then((p) => {
        if (!p) return setLoadError("We couldn't find your profile.");
        setRating(p.rating);
        setVerified(p.ratingSource === "verified");
        setLoaded(true);
      })
      .catch(() => setLoadError("We couldn't load your profile. Check your connection."));
  }, [getToken, editing]);
  useEffect(load, [load]);

  async function next() {
    if (rating == null) return;
    setError(null);
    setBusy(true);
    try {
      await saveSelfRating(getToken, rating);
      if (editing) router.back();
      else router.push("/onboarding/intent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <EditLoading error={loadError} onRetry={load} />;

  if (verified && rating != null) {
    return (
      <OnboardingStep title="Linked to UTR">
        <Card style={{ gap: spacing.space3 }}>
          <RatingBadge rating={rating} source="verified" />
          <Text tone="inkMuted">Your level comes from your UTR account, so it can't be changed here.</Text>
        </Card>
      </OnboardingStep>
    );
  }

  return (
    <OnboardingStep
      step={editing ? undefined : "rating"}
      title="How do you play?"
      subtitle="Pick the one that sounds most like you. It sets your Ball Boi Rating, which we use to match you with players at your level. You can change it later."
      footer={<Button label={editing ? "Save" : "Continue"} onPress={next} loading={busy} disabled={rating == null} />}
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
