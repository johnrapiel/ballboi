import { ClerkLoaded, ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import {
  CormorantGaramond_500Medium,
  CormorantGaramond_500Medium_Italic,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_600SemiBold_Italic,
  CormorantGaramond_700Bold,
} from "@expo-google-fonts/cormorant-garamond";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  useFonts,
} from "@expo-google-fonts/dm-sans";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { setBaseUrl } from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useColors } from "@/hooks/useColors";

const apiUrl = process.env.EXPO_PUBLIC_API_URL;
if (apiUrl) setBaseUrl(apiUrl);

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const colors = useColors();
  // Standard iOS header for screens pushed from a tab: back at the top left.
  const pushedHeader = {
    headerShown: true,
    headerBackButtonDisplayMode: "minimal",
    headerShadowVisible: false,
    headerTintColor: colors.ink,
    headerStyle: { backgroundColor: colors.paper },
    headerTitleStyle: { fontFamily: "DMSans_600SemiBold", color: colors.ink },
  } as const;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="age-check" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="eighteen-plus" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="messages" options={{ ...pushedHeader, title: "Messages" }} />
      <Stack.Screen name="delete-account" options={{ ...pushedHeader, title: "Delete account" }} />
      <Stack.Screen
        name="league/new"
        options={{
          headerShown: true,
          presentation: "modal",
          title: "New league",
          headerShadowVisible: false,
          headerTintColor: colors.ink,
          headerStyle: { backgroundColor: colors.paper },
          headerTitleStyle: { fontFamily: "DMSans_600SemiBold", color: colors.ink },
        }}
      />
      <Stack.Screen
        name="league/join"
        options={{
          headerShown: false,
          presentation: "formSheet",
          sheetAllowedDetents: "fitToContents",
          sheetGrabberVisible: true,
          sheetCornerRadius: 18,
          contentStyle: { backgroundColor: colors.linen },
        }}
      />
      <Stack.Screen
        name="league/invite/[leagueId]"
        options={{
          headerShown: true,
          presentation: "modal",
          title: "",
          gestureEnabled: false,
          headerShadowVisible: false,
          headerTintColor: colors.ink,
          headerStyle: { backgroundColor: colors.paper },
        }}
      />
      <Stack.Screen
        name="league/[leagueId]/score/[matchId]"
        options={{
          headerShown: false,
          presentation: "formSheet",
          sheetAllowedDetents: [1.0],
          sheetGrabberVisible: true,
          sheetCornerRadius: 18,
          contentStyle: { backgroundColor: colors.linen },
        }}
      />
      <Stack.Screen name="league/[leagueId]/manage" options={{ ...pushedHeader, title: "" }} />
      <Stack.Screen name="league/[leagueId]/round/[roundId]" options={{ ...pushedHeader, title: "" }} />
      <Stack.Screen
        name="league/[leagueId]/index"
        options={{
          headerShown: true,
          title: "",
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerTintColor: colors.ink,
          headerStyle: { backgroundColor: colors.paper },
        }}
      />
      <Stack.Screen
        name="record/[matchId]"
        options={{ headerShown: false, presentation: "fullScreenModal", gestureEnabled: false }}
      />
      <Stack.Screen
        name="record/quick"
        options={{
          headerShown: true,
          presentation: "modal",
          title: "Quick match",
          headerShadowVisible: false,
          headerTintColor: colors.ink,
          headerStyle: { backgroundColor: colors.paper },
          headerTitleStyle: { fontFamily: "DMSans_600SemiBold", color: colors.ink },
        }}
      />
      <Stack.Screen name="record/invite/[code]" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen
        name="replay/[matchId]"
        options={{ headerShown: false, presentation: "card" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    // Design system type: DM Sans for everything you read or tap,
    // Cormorant Garamond for titles and scores.
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    CormorantGaramond_500Medium,
    CormorantGaramond_500Medium_Italic,
    CormorantGaramond_600SemiBold,
    // One step heavier, for Night session display text and iOS Bold Text.
    CormorantGaramond_600SemiBold_Italic,
    CormorantGaramond_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={tokenCache}
    >
      <ClerkLoaded>
        <SafeAreaProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
