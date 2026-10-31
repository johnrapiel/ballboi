import { useAuth, useUser } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";
import React from "react";

import { useColors } from "@/hooks/useColors";
import { isAgeCheckPassed } from "@/lib/ageCheck";

// Onboarding steps 3 to 6 (spec: Roles and onboarding): name and photo, home
// area, rating quiz, "What brings you here?". Standard iOS stack: back at the
// top left and swipe back between steps. Titles stay empty because each step
// shows its own large title and step count.

export default function OnboardingLayout() {
  const c = useColors();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/welcome" />;
  if (!user) return null;
  if (!isAgeCheckPassed(user.unsafeMetadata)) return <Redirect href="/age-check" />;

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
