import { useAuth, useUser } from "@clerk/expo";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Redirect, Tabs } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { SymbolView, type SFSymbol } from "expo-symbols";
import React, { useEffect } from "react";
import { Platform, StyleSheet, useColorScheme } from "react-native";

import { useColors } from "@/hooks/useColors";
import { isAgeCheckPassed } from "@/lib/ageCheck";

// The five tabs, in order, with Ball Boi in the center (spec: Navigation).
// Labels are the words used everywhere else in the app for these places.
// Profile isn't a tab: it opens from your photo in the top corner of every tab.
const TABS: {
  name: string;
  label: string;
  symbol: SFSymbol;
  selected: SFSymbol;
  feather: React.ComponentProps<typeof Feather>["name"];
}[] = [
  { name: "index", label: "Home", symbol: "house", selected: "house.fill", feather: "home" },
  { name: "leagues", label: "Leagues", symbol: "trophy", selected: "trophy.fill", feather: "award" },
  { name: "ballboi", label: "Ball Boi", symbol: "tennisball", selected: "tennisball.fill", feather: "circle" },
  { name: "discover", label: "Discover", symbol: "safari", selected: "safari.fill", feather: "compass" },
  { name: "messages", label: "Messages", symbol: "message", selected: "message.fill", feather: "message-circle" },
];

/** iOS 26+: the system Liquid Glass tab bar. */
function NativeTabLayout() {
  const c = useColors();
  return (
    <NativeTabs tintColor={c.ink}>
      {TABS.map((t) => (
        <NativeTabs.Trigger key={t.name} name={t.name}>
          <NativeTabs.Trigger.Icon sf={{ default: t.symbol, selected: t.selected }} />
          <NativeTabs.Trigger.Label>{t.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

/** Older iOS: a standard blurred tab bar with the same tabs and icons. */
function ClassicTabLayout() {
  const c = useColors();
  const isDark = useColorScheme() === "dark";
  const isIOS = Platform.OS === "ios";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.inkMuted,
        tabBarLabelStyle: { fontFamily: "DMSans_500Medium" },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : c.paper,
          borderTopWidth: 1,
          borderTopColor: c.hairline,
          elevation: 0,
        },
        tabBarBackground: () =>
          isIOS ? <BlurView intensity={100} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} /> : null,
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.label,
            tabBarAccessibilityLabel: t.label,
            tabBarIcon: ({ color, focused }) =>
              isIOS ? (
                <SymbolView name={focused ? t.selected : t.symbol} tintColor={color} size={24} />
              ) : (
                <Feather name={t.feather} size={22} color={color as string} />
              ),
          }}
        />
      ))}
    </Tabs>
  );
}

export default function TabLayout() {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/welcome" />;
  if (!user) return null;
  if (!isAgeCheckPassed(user.unsafeMetadata)) return <Redirect href="/age-check" />;

  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
