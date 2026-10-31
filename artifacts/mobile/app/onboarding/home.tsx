// Onboarding step 4: home area (spec: Roles and onboarding; Discover > Location
// and privacy). A zip is all it takes. "Use my location" is an optional
// shortcut that asks for While Using permission only, fills the zip, and keeps
// an approximate location (the API rounds it). Denying location never blocks.

import { useAuth } from "@clerk/expo";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import React, { useState } from "react";

import { OnboardingStep, StepError } from "@/components/OnboardingStep";
import { Button, Field, Text } from "@/components/ui";
import { isZip, saveHomeArea } from "@/lib/onboarding";

type Coords = { latitude: number; longitude: number };

export default function HomeAreaStep() {
  const router = useRouter();
  const { getToken } = useAuth();

  const [zip, setZip] = useState("");
  /** Set only while the zip is the one "Use my location" filled in. */
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = isZip(zip);

  async function locate() {
    setNote(null);
    setError(null);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setNote("Location is off for Ball Boi. Enter your zip code instead.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [place] = await Location.reverseGeocodeAsync(pos.coords);
      const found = place?.postalCode?.slice(0, 5) ?? "";
      if (!isZip(found)) {
        setNote("We couldn't find a zip code here. Enter it instead.");
        return;
      }
      setZip(found);
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setNote(`Found ${found}.`);
    } catch {
      setNote("We couldn't get your location. Enter your zip code instead.");
    } finally {
      setLocating(false);
    }
  }

  async function next() {
    if (!valid) return;
    setError(null);
    setBusy(true);
    try {
      await saveHomeArea(getToken, { zip: zip.trim(), ...(coords ?? {}) });
      router.push("/onboarding/rating");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingStep
      step="home"
      title="Where do you play?"
      subtitle="We show players and leagues near your home area. Others only see an approximate distance, never where you are."
      footer={<Button label="Continue" onPress={next} loading={busy} disabled={!valid} />}
    >
      <Field
        label="Zip code"
        value={zip}
        onChangeText={(v) => {
          setZip(v.replace(/\D/g, "").slice(0, 5));
          setCoords(null);
          setNote(null);
        }}
        keyboardType="number-pad"
        maxLength={5}
        autoComplete="postal-code"
        textContentType="postalCode"
        returnKeyType="done"
        hint="5 digits"
      />

      <Button
        label="Use my location"
        variant="secondary"
        onPress={locate}
        loading={locating}
        accessibilityHint="Fills in your zip code from your current location"
      />
      {note ? (
        <Text variant="small" tone="inkMuted" accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}

      <StepError message={error} />
    </OnboardingStep>
  );
}
