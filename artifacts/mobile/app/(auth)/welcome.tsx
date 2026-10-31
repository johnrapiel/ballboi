// Welcome / sign in.
// Spec: Roles and onboarding, step 1 (Apple, Google, or email code).
// Canvas: "Welcome / Sign in".

import { useSSO } from "@clerk/expo";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import { View } from "react-native";

import { Button, Screen, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { friendlyAuthError } from "@/lib/authErrors";

// Lets the Apple and Google browser sheet hand the session back to the app.
WebBrowser.maybeCompleteAuthSession();

type Provider = "oauth_apple" | "oauth_google";

export default function WelcomeScreen() {
  const router = useRouter();
  const { startSSOFlow } = useSSO();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Opening the browser sheet is faster when it's warmed up first.
  useEffect(() => {
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  async function signInWith(strategy: Provider) {
    setError(null);
    setBusy(strategy);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({ strategy });
      // A null session means the person closed the sheet: not an error.
      if (createdSessionId && setActive) await setActive({ session: createdSessionId });
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen style={{ paddingTop: spacing.space12, alignItems: "center", gap: spacing.space6 }}>
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
            Your league, your matches and a ball boi in your pocket that tracks every shot.
          </Text>
        </View>

        <View style={{ marginTop: "auto", width: "100%", gap: spacing.space3 }}>
          {error ? (
            <Text tone="danger" accessibilityRole="alert" style={{ textAlign: "center" }}>
              {error}
            </Text>
          ) : null}
          <Button
            label="Sign in with Apple"
            loading={busy === "oauth_apple"}
            disabled={busy !== null}
            onPress={() => signInWith("oauth_apple")}
          />
          <Button
            label="Continue with Google"
            variant="secondary"
            loading={busy === "oauth_google"}
            disabled={busy !== null}
            onPress={() => signInWith("oauth_google")}
          />
          <Button
            label="Continue with email"
            variant="secondary"
            disabled={busy !== null}
            onPress={() => router.push("/(auth)/email")}
          />
          <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
            Got an invite link? Sign in first and it'll open right after.
          </Text>
        </View>
      </Screen>
    </View>
  );
}
