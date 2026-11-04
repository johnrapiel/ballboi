// Onboarding step 4: home area (spec: Roles and onboarding; Discover > Location
// and privacy). A zip is all it takes. "Use my location" is an optional
// shortcut that asks for While Using permission only, fills the zip, and keeps
// an approximate location (the API rounds it). Denying location never blocks.
// Also Profile > Edit profile > Home area (mode="edit"), prefilled.

import { useAuth } from "@clerk/expo";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";

import { OnboardingStep, StepError } from "@/components/OnboardingStep";
import { EditLoading } from "@/components/profile/EditLoading";
import { Button, Field, Text } from "@/components/ui";
import { fetchProfile, isZip, saveHomeArea, type FormMode } from "@/lib/onboarding";

type Coords = { latitude: number; longitude: number };

export default function HomeAreaStep({ mode = "onboarding" }: { mode?: FormMode }) {
  const editing = mode === "edit";
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

  // Start from the saved zip (A14): always in edit mode, where Save waits until
  // it has loaded, and when resuming onboarding. A slow load never replaces a
  // zip the person already started typing or filled from their location.
  const [savedZip, setSavedZip] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!editing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const touched = useRef(false);
  const load = useCallback(() => {
    setLoadError(null);
    fetchProfile(getToken)
      .then((p) => {
        if (!p) {
          if (editing) setLoadError("We couldn't find your profile.");
          return;
        }
        setSavedZip(p.homeZip);
        if (!touched.current) setZip(p.homeZip ?? "");
        setLoaded(true);
      })
      .catch(() => {
        if (editing) setLoadError("We couldn't load your profile. Check your connection and try again.");
      });
  }, [getToken, editing]);
  useEffect(load, [load]);

  // A11: iOS ignores live regions, so say each location note out loud, the way
  // StepError does: "Found 12590." or why it couldn't.
  useEffect(() => {
    if (note) AccessibilityInfo.announceForAccessibility(note);
  }, [note]);

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
      touched.current = true;
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
    // Nothing changed: saving the zip alone would drop the approximate
    // location from an earlier "Use my location".
    if (!coords && zip.trim() === savedZip) return editing ? router.back() : router.push("/onboarding/rating");
    setError(null);
    setBusy(true);
    try {
      await saveHomeArea(getToken, { zip: zip.trim(), ...(coords ?? {}) });
      if (editing) router.back();
      else router.push("/onboarding/rating");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <EditLoading error={loadError} onRetry={load} />;

  return (
    <OnboardingStep
      step={editing ? undefined : "home"}
      title="Where do you play?"
      reason="So we can match you with players nearby."
      subtitle="We show players and leagues near your home area. Others only see an approximate distance, never where you are."
      footer={<Button label={editing ? "Save" : "Continue"} onPress={next} loading={busy} disabled={!valid} />}
    >
      <Field
        label="Zip code"
        value={zip}
        onChangeText={(v) => {
          touched.current = true;
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
