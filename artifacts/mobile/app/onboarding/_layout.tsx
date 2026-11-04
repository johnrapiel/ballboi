import { Stack } from "expo-router";
import React from "react";

import { useColors } from "@/hooks/useColors";
import { useGate } from "@/hooks/useGate";

// Onboarding steps 3 to 6 (spec: Roles and onboarding): name and photo, home
// area, rating quiz, "What brings you here?". Standard iOS stack: back at the
// top left and swipe back between steps. Titles stay empty because each step
// shows its own large title and step count.

export default function OnboardingLayout() {
  const c = useColors();
  const gate = useGate();

  // The root gate (app/_layout.tsx) sends anyone signed out, blocked or
  // before the age check elsewhere (A6); render nothing for them meanwhile.
  // "app" covers the moment the last step finishes and moves on to Home.
  if (gate !== "onboarding" && gate !== "app") return null;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        title: "",
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerTintColor: c.ink,
        headerStyle: { backgroundColor: c.paper },
        contentStyle: { backgroundColor: c.paper },
      }}
    >
      {/* The first step has nothing behind it: no back button, no swipe back. */}
      <Stack.Screen name="index" options={{ headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="home" />
      <Stack.Screen name="rating" />
      <Stack.Screen name="intent" />
    </Stack>
  );
}
