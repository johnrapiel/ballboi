// Shown to anyone under 18 after the age check. Their account was deleted.
// Spec: Roles and onboarding, step 2 ("Ball Boi is 18+ for now").

import { useRouter } from "expo-router";
import React from "react";
import { View } from "react-native";

import { Button, Screen, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";

export default function EighteenPlusScreen() {
  const router = useRouter();
  return (
    <Screen style={{ justifyContent: "center", gap: spacing.space6 }}>
      <View style={{ gap: spacing.space3 }}>
        <Text variant="displayL" accessibilityRole="header">
          Ball Boi is 18+ for now.
        </Text>
        <Text tone="inkMuted">
          We're starting with adult players, so we didn't create an account. Thanks for stopping by the courts.
        </Text>
      </View>
      <Button label="Back to start" variant="secondary" onPress={() => router.replace("/(auth)/welcome")} />
    </Screen>
  );
}
