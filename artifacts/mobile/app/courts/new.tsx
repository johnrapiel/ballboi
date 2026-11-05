import {
  getGetCourtsQueryKey,
  getGetMyDiscoverSettingsQueryKey,
  useAddCourt,
  useSetMyHomeCourt,
  type AddedCourt,
  type NewCourt,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Alert, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChoiceGroup } from "@/components/Choice";
import { Button, Field, KeyboardScreen, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/hooks/useProfile";
import { COURT_SURFACE_LABEL, parseCourtCount } from "@/lib/discover";

// Add a court (spec: Discover, "players can add missing courts"). One shared
// list, so a court added here shows for every player nearby. "I'm at the
// court" places it exactly; otherwise it sits at its zip's center.

type Surface = NonNullable<NewCourt["surface"]>;
type Unsure = "unsure";

export default function AddCourtScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { profile } = useProfile();
  const add = useAddCourt();
  const setHome = useSetMyHomeCourt();

  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [zip, setZip] = useState("");
  const [access, setAccess] = useState<"public" | "club">("public");
  const [surface, setSurface] = useState<Surface | Unsure>("unsure");
  const [lights, setLights] = useState<"yes" | "no" | Unsure>("unsure");
  const [count, setCount] = useState("");
  const [here, setHere] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start from the player's own zip; most courts they add are near home.
  useEffect(() => {
    if (profile?.homeZip) setZip((z) => z || profile.homeZip!);
  }, [profile?.homeZip]);

  useEffect(() => {
    if (note) AccessibilityInfo.announceForAccessibility(note);
  }, [note]);

  const courtCount = parseCourtCount(count);
  const ready = name.trim().length >= 2 && /^\d{5}$/.test(zip.trim()) && courtCount !== "invalid";

  async function locate() {
    setNote(null);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setNote("Location is off for Ball Boi. The court will sit at its zip code's center.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [found] = await Location.reverseGeocodeAsync(pos.coords);
      const foundZip = found?.postalCode?.slice(0, 5);
      if (foundZip && /^\d{5}$/.test(foundZip)) setZip(foundZip);
      setHere({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setNote("Got it. The court goes where you're standing.");
    } catch {
      setNote("We couldn't get your location. The court will sit at its zip code's center.");
    } finally {
      setLocating(false);
    }
  }

  const done = (court: AddedCourt) => {
    void queryClient.invalidateQueries({ queryKey: getGetCourtsQueryKey() });
    const makeHome = () =>
      setHome.mutate(
        { data: { courtId: court.courtId } },
        {
          onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: getGetCourtsQueryKey() });
            void queryClient.invalidateQueries({ queryKey: getGetMyDiscoverSettingsQueryKey() });
            router.back();
          },
          onError: () => Alert.alert("Couldn't save", "Check your connection and try again."),
        },
      );
    Alert.alert(
      court.existing ? "Already in the list" : "Court added",
      court.existing ? `${court.name} is already in the directory.` : `${court.name} is in the directory for players near you.`,
      [
        { text: "Not now", style: "cancel", onPress: () => router.back() },
        { text: "Make it my home court", onPress: makeHome },
      ],
    );
  };

  const submit = () => {
    if (!ready) return;
    setError(null);
    const data: NewCourt = {
      name: name.trim(),
      place: place.trim() || null,
      zip: zip.trim(),
      access,
      surface: surface === "unsure" ? null : surface,
      lights: lights === "unsure" ? null : lights === "yes",
      courtCount,
      ...(here ?? {}),
    };
    add.mutate(
      { data },
      {
        onSuccess: done,
        onError: (e) => {
          const message = (e as { data?: { error?: string } }).data?.error;
          setError(message ?? "We couldn't add the court. Check your connection and try again.");
        },
      },
    );
  };

  return (
    <KeyboardScreen>
      <ScrollView
        style={{ flex: 1, backgroundColor: c.paper }}
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space6, gap: spacing.space6 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text tone="inkMuted">Courts you add show for every player nearby. Leave anything you're not sure of.</Text>

        <Field label="Court name" value={name} onChangeText={setName} placeholder="Like Rudd Pond Tennis Courts" maxLength={60} autoCapitalize="words" />
        <Field
          label="Where it is (optional)"
          value={place}
          onChangeText={setPlace}
          placeholder="Park or cross streets"
          maxLength={80}
        />

        <View style={{ gap: spacing.space3 }}>
          <Field
            label="Zip code"
            value={zip}
            onChangeText={(z) => setZip(z.replace(/\D/g, "").slice(0, 5))}
            keyboardType="number-pad"
            maxLength={5}
          />
          <Button
            variant="secondary"
            label={here ? "Using where you're standing" : "I'm at the court"}
            accessibilityHint="Uses your location to place the court exactly"
            loading={locating}
            onPress={() => void locate()}
          />
          {note ? (
            <Text variant="small" tone="inkMuted">
              {note}
            </Text>
          ) : null}
        </View>

        <ChoiceGroup<"public" | "club">
          label="Who can play"
          value={access}
          onChange={setAccess}
          options={[
            { value: "public", label: "Public" },
            { value: "club", label: "Club" },
          ]}
          hint={access === "club" ? "Members or guests only." : "Anyone can play."}
        />

        <ChoiceGroup<Surface | Unsure>
          label="Surface"
          value={surface}
          onChange={setSurface}
          options={[
            { value: "unsure", label: "Not sure" },
            ...(Object.keys(COURT_SURFACE_LABEL) as Surface[]).map((s) => ({ value: s, label: s === "other" ? "Other" : COURT_SURFACE_LABEL[s] })),
          ]}
        />

        <ChoiceGroup<"yes" | "no" | Unsure>
          label="Lights"
          value={lights}
          onChange={setLights}
          options={[
            { value: "unsure", label: "Not sure" },
            { value: "yes", label: "Lights" },
            { value: "no", label: "No lights" },
          ]}
        />

        <Field
          label="Number of courts (optional)"
          value={count}
          onChangeText={(t) => setCount(t.replace(/\D/g, "").slice(0, 2))}
          keyboardType="number-pad"
          maxLength={2}
          error={courtCount === "invalid"}
          hint={courtCount === "invalid" ? "Enter a number from 1 to 60." : undefined}
        />

        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button label="Add court" disabled={!ready} loading={add.isPending || setHome.isPending} onPress={submit} />
      </ScrollView>
    </KeyboardScreen>
  );
}
