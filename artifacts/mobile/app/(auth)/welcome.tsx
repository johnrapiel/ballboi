// Welcome / sign in.
// Spec: Roles and onboarding, step 1 (Apple, Google, or email code).
// Canvas: "Welcome / Sign in"; approved copy and layout (John, Nov 5): the
// headline is "Rec leagues, done properly." in Cormorant at title size, with
// the subline and invite note in quieter text.
//
// Apple and Google use their own sign-in (Clerk's useSignInWithApple and
// useSignInWithGoogle) instead of Clerk's browser sheet. A new account from either
// lands signed in, and the root gate (app/_layout.tsx) takes it through the
// age check and onboarding, the same as email.

import { useSignInWithApple } from "@clerk/expo/apple";
import { useSignInWithGoogle } from "@clerk/expo/google";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { useWindowDimensions, View } from "react-native";

import {
  AppleSignInButton,
  GoogleSignInButton,
  SIGN_IN_BUTTON_HEIGHT,
  useSignInOptions,
} from "@/components/SocialSignInButtons";
import { Roundel } from "@/components/Roundel";
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
  // At the largest text sizes the roundel steps down, so the headline and the
  // sign-in buttons need less scrolling (finding #28).
  const { fontScale } = useWindowDimensions();
  const roundelSize = fontScale > 1.5 ? 140 : 200;

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
    // The roundel, headline and subline sit centred in the space between the
    // status bar and the sign-in buttons (finding #28). The group grows to fill
    // that space; when text is too big to fit, it keeps its natural height and
    // the screen scrolls instead.
    <ScrollScreen style={{ gap: spacing.space6 }}>
      <View
        style={{
          flexGrow: 1,
          justifyContent: "center",
          alignItems: "center",
          gap: spacing.space6,
          paddingVertical: spacing.space6,
        }}
      >
        <Roundel size={roundelSize} accessibilityLabel="Ball Boi" />
        <View style={{ gap: spacing.space3, maxWidth: 320, alignItems: "center" }}>
          <Text variant="title" accessibilityRole="header" style={{ textAlign: "center" }}>
            Rec leagues, done properly.
          </Text>
          <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
            Your league, your matches, and Ball Boi tracking every shot.
          </Text>
        </View>
      </View>

      <View style={{ width: "100%", gap: spacing.space3 }}>
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
          Got an invite link? Sign in first and it opens right after.
        </Text>
      </View>
    </ScrollScreen>
  );
}
