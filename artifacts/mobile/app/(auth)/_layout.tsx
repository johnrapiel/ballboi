import { useAuth } from "@clerk/expo";
import { Stack } from "expo-router";
import React from "react";

export default function AuthLayout() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) return null;
  // Signed-in players move on from here through the root gate
  // (app/_layout.tsx): account check, age check, onboarding, then the app.
  if (isSignedIn) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="email" />
    </Stack>
  );
}
