// Onboarding step 5: level quiz (spec: Roles and onboarding; Ball Boi Rating).
// Pick the description that sounds most like you. It sets the player's
// self-rated level for matching, on the NTRP scale (Wave 1 review S9: the UI
// calls it "self-rated level"). Only the player changes it; results don't move
// it. "Link UTR instead" is shown but disabled until the UTR Engage integration
// lands.
//
// Also Profile > Edit profile > Self-rated level (mode="edit"): prefilled, and
// Save posts the same self-rated level. A Verified (UTR) level can't be changed
// here, so "Linked to UTR" shows instead of the quiz.

import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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

  // Start from the saved level (A14): always in edit mode, where Save waits
  // until it has loaded, and when resuming onboarding. A slow load never
  // replaces a level the person already picked.
  const [verified, setVerified] = useState(false);
  const [loaded, setLoaded] = useState(!editing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const picked = useRef(false);
  const pick = (r: number) => {
    picked.current = true;
    setRating(r);
  };
  const load = useCallback(() => {
    setLoadError(null);
    fetchProfile(getToken)
      .then((p) => {
        if (!p) {
          if (editing) setLoadError("We couldn't find your profile.");
          return;
        }
        if (!picked.current) setRating(p.rating);
        // The "Linked to UTR" view is for Edit profile; onboarding always shows the quiz.
        if (editing) setVerified(p.ratingSource === "verified");
        setLoaded(true);
      })
      .catch(() => {
        if (editing) setLoadError("We couldn't load your profile. Check your connection.");
      });
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
      reason="So your matches are fair."
      subtitle={
        editing
          ? "This is your self-rated level. We use it to match you with players near your level."
          : "This is your self-rated level. We use it to match you with players near your level. You can change it anytime in Edit profile."
      }
      footer={<Button label={editing ? "Save" : "Continue"} onPress={next} loading={busy} disabled={rating == null} />}
    >
      <View accessibilityRole="radiogroup" accessibilityLabel="Self-rated level" style={{ gap: spacing.space3 }}>
        {QUIZ_LEVELS.map((level) => (
          <RadioCard
            key={level.rating}
            title={level.title}
            description={level.description}
            meta={{ text: formatRating(level.rating), spoken: `Level ${formatRating(level.rating)}` }}
            selected={rating === level.rating}
            onPress={() => pick(level.rating)}
          />
        ))}
      </View>

      {rating != null ? (
        <View style={{ gap: spacing.space2 }}>
          <Text variant="label" tone="inkMuted">
            Your level
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
          Coming soon. Linking UTR will set your level and show a Verified badge.
        </Text>
      </View>

      <StepError message={error} />
    </OnboardingStep>
  );
}
