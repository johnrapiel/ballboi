// Age check, right after first sign-in.
// Spec: Roles and onboarding, step 2. Ball Boi is 18+ for the MVP.
// Only a pass flag is stored (on the Clerk user). The birth date never
// leaves this screen. Under 18: the account is deleted and the person sees
// the "18+ for now" screen.
//
// TODO(native build): ask Apple's Declared Age Range API first and fall back
// to this form only when it returns nothing. It isn't available in Expo Go.

import { useAuth, useUser } from "@clerk/expo";
import { Redirect, useRouter } from "expo-router";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";

import { Button, Field, Screen, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { AGE_CHECK_PASSED, ageOn, isAgeCheckPassed, parseBirthDate } from "@/lib/ageCheck";

export default function AgeCheckScreen() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isLoaded) return null;
  if (!isSignedIn || !user) return <Redirect href="/(auth)/welcome" />;
  if (isAgeCheckPassed(user.unsafeMetadata)) return <Redirect href="/(tabs)" />;

  const complete = month.length > 0 && day.length > 0 && year.length === 4;

  async function submit() {
    if (!user) return;
    setError(null);
    const birthDate = parseBirthDate(month, day, year);
    if (!birthDate) return setError("That date doesn't exist. Check the month, day and year.");

    setBusy(true);
    try {
      if (ageOn(birthDate, new Date()) >= 18) {
        await user.update({ unsafeMetadata: { ...user.unsafeMetadata, ageCheck: AGE_CHECK_PASSED } });
        router.replace("/(tabs)");
      } else {
        // No account for under-18s: remove the one sign-in just created.
        await user.delete();
        router.replace("/eighteen-plus");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const digits = (set: (v: string) => void, max: number) => (t: string) => set(t.replace(/\D/g, "").slice(0, max));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen style={{ gap: spacing.space6 }}>
        <View style={{ gap: spacing.space2, marginTop: spacing.space8 }}>
          <Text variant="label" tone="inkMuted">
            One quick check
          </Text>
          <Text variant="displayL" accessibilityRole="header">
            When were you born?
          </Text>
          <Text tone="inkMuted">Ball Boi is for players 18 and up. We only keep a yes or no, never your birthday.</Text>
        </View>

        <View style={{ flexDirection: "row", gap: spacing.space3 }}>
          <View style={{ flex: 1 }}>
            <Field label="Month" placeholder="MM" value={month} onChangeText={digits(setMonth, 2)} keyboardType="number-pad" maxLength={2} textContentType="none" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Day" placeholder="DD" value={day} onChangeText={digits(setDay, 2)} keyboardType="number-pad" maxLength={2} />
          </View>
          <View style={{ flex: 1.4 }}>
            <Field label="Year" placeholder="YYYY" value={year} onChangeText={digits(setYear, 4)} keyboardType="number-pad" maxLength={4} />
          </View>
        </View>

        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Button label="Continue" loading={busy} disabled={!complete} onPress={submit} style={{ marginTop: "auto" }} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
