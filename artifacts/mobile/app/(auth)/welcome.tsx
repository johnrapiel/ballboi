// Welcome / sign in.
// Spec: Roles and onboarding, step 1 (Apple, Google, or email code).
// Canvas: "Welcome / Sign in".
//
// Apple and Google use their own sign-in (Clerk's useSignInWithApple and
// useSignInWithGoogle) instead of Clerk's browser sheet. A new account from either
// lands signed in, and the root gate (app/_layout.tsx) takes it through the
// age check and onboarding, the same as email.

import { useSignInWithApple } from "@clerk/expo/apple";
import { useSignInWithGoogle } from "@clerk/expo/google";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";

import {
  AppleSignInButton,
  GoogleSignInButton,
  SIGN_IN_BUTTON_HEIGHT,
  useSignInOptions,
} from "@/components/SocialSignInButtons";
import { Button, ScrollScreen, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { friendlyAuthError } from "@/lib/authErrors";

type Provider = "apple" | "google";

export default function WelcomeScreen() {
  const router = useRouter();
  const options = useSignInOptions();
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const { startGoogleAuthenticationFlow } = useSignInWithGoogle();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signInWith(provider: Provider) {
    setError(null);
    setBusy(provider);
    try {
      const { createdSessionId, setActive } =
        provider === "apple" ? await startAppleAuthenticationFlow() : await startGoogleAuthenticationFlow();
      // A null session means the person closed Apple's or Google's sheet: not an error.
      if (createdSessionId && setActive) await setActive({ session: createdSessionId });
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    // Scrolls at the largest text sizes, so the sign-in buttons stay reachable (A8).
    <ScrollScreen style={{ paddingTop: spacing.space12, alignItems: "center", gap: spacing.space6 }}>
      <Image
        source={require("@/assets/images/roundel.png")}
        style={{ width: 200, height: 200, borderRadius: 100 }}
        accessibilityLabel="Ball Boi"
        accessibilityRole="image"
      />
      <View style={{ gap: spacing.space3, maxWidth: 320, alignItems: "center" }}>
        <Text variant="displayL" accessibilityRole="header" style={{ textAlign: "center" }}>
          Club tennis, done properly.
        </Text>
        <Text tone="inkMuted" style={{ textAlign: "center" }}>
          Your league, your matches and a Ball Boi in your pocket that tracks every shot.
        </Text>
      </View>

      <View style={{ marginTop: "auto", width: "100%", gap: spacing.space3 }}>
        {error ? (
          <Text tone="danger" accessibilityRole="alert" style={{ textAlign: "center" }}>
            {error}
          </Text>
        ) : null}
        {options?.apple ? (
          <AppleSignInButton disabled={busy !== null} onPress={() => signInWith("apple")} />
        ) : null}
        {options?.google ? (
          <GoogleSignInButton
            loading={busy === "google"}
            disabled={busy !== null}
            onPress={() => signInWith("google")}
          />
        ) : null}
        <Button
          label="Continue with email"
          variant="secondary"
          disabled={busy !== null}
          style={{ minHeight: SIGN_IN_BUTTON_HEIGHT }}
          onPress={() => router.push("/(auth)/email")}
        />
        <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
          Got an invite link? Sign in first and it'll open right after.
        </Text>
      </View>
    </ScrollScreen>
  );
}
