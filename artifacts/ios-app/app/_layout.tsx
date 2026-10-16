import { useEffect } from "react";
import { ClerkLoaded, ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { DMSans_400Regular, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { DMMono_500Medium } from "@expo-google-fonts/dm-mono";
import { PlayfairDisplay_700Bold } from "@expo-google-fonts/playfair-display";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { config } from "@/lib/config";
import { tokenCache } from "@/lib/tokenCache";
import { useTheme } from "@/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});
setBaseUrl(config.apiUrl);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

function AuthGate() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const { c, scheme } = useTheme();

  // Every API call carries the Clerk session as a bearer token.
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    const inAuth = segments[0] === "(auth)";
    if (!isSignedIn && !inAuth) router.replace("/(auth)/sign-in");
    if (isSignedIn && inAuth) router.replace("/(tabs)");
    if (!isSignedIn) queryClient.clear();
  }, [isLoaded, isSignedIn, segments, router]);

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerTintColor: c.primary,
          headerStyle: { backgroundColor: c.background },
          headerTitleStyle: { fontFamily: "DMSans_700Bold", color: c.text },
          contentStyle: { backgroundColor: c.background },
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="record" options={{ presentation: "fullScreenModal", headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_700Bold,
    DMMono_500Medium,
    PlayfairDisplay_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <ClerkProvider publishableKey={config.clerkPublishableKey} tokenCache={tokenCache}>
      <ClerkLoaded>
        <QueryClientProvider client={queryClient}>
          <AuthGate />
        </QueryClientProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
