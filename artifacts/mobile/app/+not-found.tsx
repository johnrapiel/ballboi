import { Stack, useRouter } from "expo-router";
import React from "react";

import { Button, ScrollScreen, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";

// A link to a screen that doesn't exist (Wave 1 review A16).
export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollScreen style={{ justifyContent: "center", gap: spacing.space6 }}>
        <Text variant="title" accessibilityRole="header">
          This page doesn't exist.
        </Text>
        <Button label="Go to Home" onPress={() => router.replace("/")} />
      </ScrollScreen>
    </>
  );
}
