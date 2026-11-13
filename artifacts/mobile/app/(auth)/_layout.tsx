import { useAuth } from "@clerk/expo";
import { Stack } from "expo-router";
import React from "react";

import { AUTH_FIRST_SCREEN } from "@/lib/gate";

// Welcome is always the first sign-in screen, so the email step always has
// Welcome under it: Back and swipe back return there. Without this, Expo
// Router puts the shortest name first ("email"), and a signed-out person
// could land on the email step with no way back (Wave 2 finding 59).
export const unstable_settings = { initialRouteName: AUTH_FIRST_SCREEN };

export default function AuthLayout() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) return null;
  // Signed-in players move on from here through the root gate
  // (app/_layout.tsx): account check, age check, onboarding, then the app.
  if (isSignedIn) return null;

  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: true }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="email" />
    </Stack>
  );
}
