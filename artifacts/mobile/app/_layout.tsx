import { ClerkLoaded, ClerkProvider, useAuth, useClerk } from "@clerk/expo";
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
import { NanumBrushScript_400Regular } from "@expo-google-fonts/nanum-brush-script";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider, focusManager, useQueryClient } from "@tanstack/react-query";
import { reloadAppAsync } from "expo";
import { Stack, usePathname, useRootNavigationState, useRouter, useSegments, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { discoverScreens } from "@/components/discover/routes";
import { sheetOptions } from "@/components/Sheet";
import { Button, ScrollScreen, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { accountStatusKey } from "@/hooks/useAccountStatus";
import { useColors } from "@/hooks/useColors";
import { useGate } from "@/hooks/useGate";
import { checkForAccountBlock, onAccountBlocked } from "@/lib/accountBlocked";
import { setAppAppearance } from "@/lib/appearance";
import { gateRedirect, type PendingLink } from "@/lib/gate";
import { savePendingJoinCode } from "@/lib/leagueInvite";
import { savePendingInvite } from "@/lib/recording/pendingInvite";
import { clearUploadQueue } from "@/lib/recording/uploader";

const apiUrl = process.env.EXPO_PUBLIC_API_URL;
if (apiUrl) setBaseUrl(apiUrl);

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

SplashScreen.preventAutoHideAsync();
// Light by default, whatever the iPhone's appearance (finding #3).
setAppAppearance();

// Any request refused because the account is banned or suspended rechecks the
// account, and the gate shows the blocked screen (Wave 1 review A7).
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: checkForAccountBlock }),
  mutationCache: new MutationCache({ onError: checkForAccountBlock }),
});

// Coming back to the app counts as focus, so stale data (the account status
// included) refetches. React Native has no window focus of its own.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener("change", (state) => handleFocus(state === "active"));
  return () => sub.remove();
});

/** How long launch waits for sign-in to load before offering Try again (A15). */
const CLERK_LOAD_TIMEOUT_MS = 10_000;

/**
 * Sends the Clerk session token with every generated-client request (A4).
 * Set here, in the root, so a link that opens the app straight to an invite
 * is signed in too. Set during render, not in an effect: effects run child
 * first, so a screen's first request would otherwise go out without it.
 */
function useAuthTokenGetter() {
  const { getToken } = useAuth();
  const latest = useRef(getToken);
  latest.current = getToken;
  const set = useRef(false);
  if (!set.current) {
    setAuthTokenGetter(() => latest.current());
    set.current = true;
  }
}

/**
 * When the account changes (sign-out, Delete account), forget the previous
 * account's cached data and its recordings waiting to upload (A5, A10).
 */
function useForgetPreviousAccount() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const previous = useRef(userId);
  useEffect(() => {
    if (previous.current && previous.current !== userId) {
      qc.clear();
      void clearUploadQueue();
    }
    previous.current = userId;
  }, [userId, qc]);
}

/** A refused request rechecks the account, at most every few seconds. */
function useRecheckWhenBlocked() {
  const qc = useQueryClient();
  useEffect(() => {
    let last = 0;
    return onAccountBlocked(() => {
      if (Date.now() - last < 3_000) return;
      last = Date.now();
      void qc.invalidateQueries({ queryKey: accountStatusKey });
    });
  }, [qc]);
}

function keepPendingLink(link: PendingLink) {
  if (link.kind === "league") void savePendingJoinCode(link.code);
  else void savePendingInvite(link.code);
}

/**
 * The one gate for every signed-in screen (A3, A6): blocked, then age check,
 * then onboarding. An invite link opened before then is kept and opens once
 * the person is in the app ((tabs)/_layout.tsx). Covers the screen while it
 * checks or moves someone, so a gated screen never flashes.
 */
function useGateRedirect() {
  const gate = useGate();
  const segments = useSegments() as string[];
  const pathname = usePathname();
  const router = useRouter();
  // Navigating before the root navigator is ready throws.
  const navReady = !!useRootNavigationState()?.key;
  const redirect = gateRedirect(gate, segments, pathname);
  const to = redirect?.to ?? null;

  useEffect(() => {
    if (!redirect || !navReady) return;
    if (redirect.keep) keepPendingLink(redirect.keep);
    try {
      router.replace(redirect.to as Href);
    } catch {
      // Tried again on the next route change.
    }
    // Only when the destination, the route or readiness changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, pathname, navReady]);

  return gate === "checking" || !!redirect;
}

function Cover() {
  const c = useColors();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: c.paper, alignItems: "center", justifyContent: "center" }]}>
      <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />
    </View>
  );
}

function RootLayoutNav() {
  const colors = useColors();
  useAuthTokenGetter();
  useForgetPreviousAccount();
  useRecheckWhenBlocked();
  const covered = useGateRedirect();
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
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="age-check" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="eighteen-plus" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="messages" options={{ ...pushedHeader, title: "" }} />
        <Stack.Screen name="delete-account" options={{ ...pushedHeader, title: "Delete account" }} />
        <Stack.Screen name="settings" options={{ ...pushedHeader, title: "Settings" }} />
        <Stack.Screen name="league/new" options={sheetOptions(colors.linen, { fill: true })} />
        <Stack.Screen name="league/join" options={sheetOptions(colors.linen)} />
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
        <Stack.Screen name="league/[leagueId]/score/[matchId]" options={sheetOptions(colors.linen)} />
        <Stack.Screen name="league/[leagueId]/time/[matchId]" options={sheetOptions(colors.linen)} />
        <Stack.Screen name="league/[leagueId]/match-time" options={sheetOptions(colors.linen)} />
        <Stack.Screen name="league/[leagueId]/manage" options={{ ...pushedHeader, title: "" }} />
        <Stack.Screen name="league/[leagueId]/round/[roundId]" options={{ ...pushedHeader, title: "" }} />
        <Stack.Screen name="league/[leagueId]/scores" options={{ ...pushedHeader, title: "" }} />
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
        <Stack.Screen name="join/[code]" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="record/invite/[code]" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="record/score/[matchId]" options={sheetOptions(colors.linen)} />
        <Stack.Screen name="report/[playerId]" options={sheetOptions(colors.linen)} />
        <Stack.Screen name="feedback" options={sheetOptions(colors.linen)} />
        <Stack.Screen name="notifications" options={sheetOptions(colors.linen)} />
        <Stack.Screen name="free-times" options={sheetOptions(colors.linen)} />
        <Stack.Screen name="replay/[matchId]" options={{ ...pushedHeader, title: "Replay" }} />
        <Stack.Screen name="match/[matchId]" options={{ ...pushedHeader, title: "" }} />
        {discoverScreens(colors.linen, pushedHeader)}
      </Stack>
      {covered ? <Cover /> : null}
    </View>
  );
}

/**
 * Sign-in has to load before any screen can show (A15). Until then the splash
 * stays up. If it can't load (no connection at launch), "Can't connect" with
 * Try again, never a blank screen.
 */
function useClerkLoadFailed(isLoaded: boolean): boolean {
  const clerk = useClerk();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (isLoaded) return;
    const started = Date.now();
    const id = setInterval(() => {
      const status = (clerk as { status?: string }).status;
      if (status === "error" || Date.now() - started >= CLERK_LOAD_TIMEOUT_MS) {
        setFailed(true);
        clearInterval(id);
      }
    }, 500);
    return () => clearInterval(id);
  }, [isLoaded, clerk]);
  return failed && !isLoaded;
}

function CantConnect() {
  const [busy, setBusy] = useState(false);
  return (
    <ScrollScreen style={{ justifyContent: "center", gap: spacing.space6 }}>
      <View style={{ gap: spacing.space3 }}>
        <Text variant="displayL" accessibilityRole="header">
          Can't connect
        </Text>
        <Text tone="inkMuted">Ball Boi couldn't reach the internet. Check your connection, then try again.</Text>
      </View>
      <Button
        label="Try again"
        loading={busy}
        onPress={() => {
          setBusy(true);
          reloadAppAsync().catch(() => setBusy(false));
        }}
      />
    </ScrollScreen>
  );
}

function AppStart({ fontsReady }: { fontsReady: boolean }) {
  const { isLoaded } = useAuth();
  const failed = useClerkLoadFailed(isLoaded);
  const showing = fontsReady && (isLoaded || failed);

  useEffect(() => {
    if (showing) SplashScreen.hideAsync();
  }, [showing]);

  if (!fontsReady) return null;
  if (!isLoaded) return failed ? <CantConnect /> : null;
  return (
    <ClerkLoaded>
      <RootLayoutNav />
    </ClerkLoaded>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    // Design system type: DM Sans for everything you read or tap,
    // Cormorant Garamond for scores and display text, Nanum Brush Script
    // for page headers that echo the roundel.
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
    NanumBrushScript_400Regular,
  });

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <AppStart fontsReady={fontsLoaded || !!fontError} />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </ClerkProvider>
  );
}
