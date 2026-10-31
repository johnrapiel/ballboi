// Onboarding step 3: name and photo (spec: Roles and onboarding).
// Name is required; the photo is optional and falls back to initials.

import { useAuth, useUser } from "@clerk/expo";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { OnboardingStep, StepError } from "@/components/OnboardingStep";
import { Button, Field, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { NAME_MAX, fetchProfile, saveNameAndPhoto, uploadPhoto } from "@/lib/onboarding";
import { photoUrl } from "@/lib/photos";

type Photo =
  | { kind: "none" }
  /** Already saved on the profile. */
  | { kind: "saved"; path: string }
  /** Just picked; uploads on Continue. */
  | { kind: "picked"; asset: ImagePicker.ImagePickerAsset };

export default function NameStep() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { user } = useUser();

  const [name, setName] = useState(user?.fullName?.trim() ?? "");
  const [photo, setPhoto] = useState<Photo>({ kind: "none" });
  const [profileExists, setProfileExists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coming back to onboarding after closing the app: start from what's saved.
  useEffect(() => {
    fetchProfile(getToken)
      .then((p) => {
        if (!p) return;
        setProfileExists(true);
        if (p.displayName) setName(p.displayName);
        if (p.avatarUrl) setPhoto({ kind: "saved", path: p.avatarUrl });
      })
      .catch(() => {});
  }, [getToken]);

  const trimmed = name.trim();
  const previewUri =
    photo.kind === "picked" ? photo.asset.uri : photo.kind === "saved" ? photoUrl(photo.path) : null;

  async function pickPhoto() {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) setPhoto({ kind: "picked", asset: result.assets[0] });
  }

  async function next() {
    if (!trimmed) return;
    setError(null);
    setBusy(true);
    try {
      let avatarUrl: string | null = photo.kind === "saved" ? photo.path : null;
      if (photo.kind === "picked") {
        try {
          avatarUrl = await uploadPhoto(getToken, photo.asset);
        } catch {
          setError("Your photo didn't upload. Try again, or remove it to use your initials.");
          return;
        }
        setPhoto({ kind: "saved", path: avatarUrl });
      }
      await saveNameAndPhoto(
        getToken,
        { displayName: trimmed, avatarUrl, email: user?.primaryEmailAddress?.emailAddress ?? null },
        profileExists,
      );
      setProfileExists(true);
      router.push("/onboarding/home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingStep
      step="name"
      title="What should we call you?"
      subtitle="Your name and photo show on your player card."
      footer={<Button label="Continue" onPress={next} loading={busy} disabled={!trimmed} />}
    >
      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        maxLength={NAME_MAX}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={next}
      />

      <View style={{ gap: spacing.space3 }}>
        <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
          Photo
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space4, flexWrap: "wrap" }}>
          <Avatar name={trimmed} uri={previewUri} />
          <View style={{ gap: spacing.space2, flexShrink: 1 }}>
            <Button
              label={photo.kind === "none" ? "Add photo" : "Change photo"}
              variant="secondary"
              onPress={pickPhoto}
            />
            {photo.kind !== "none" ? (
              <Button label="Remove photo" variant="secondary" onPress={() => setPhoto({ kind: "none" })} />
            ) : null}
          </View>
        </View>
        <Text variant="small" tone="inkMuted">
          {photo.kind === "none" ? "Optional. Your initials show until you add one." : "Photo added."}
        </Text>
      </View>

      <StepError message={error} />
    </OnboardingStep>
  );
}
