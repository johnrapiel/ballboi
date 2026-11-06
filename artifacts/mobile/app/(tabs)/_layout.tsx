import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { useAuth } from "@clerk/expo";
import { Tabs, useRouter } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { SymbolView, type SFSymbol } from "expo-symbols";
import React, { useEffect } from "react";
import { Image, Platform, StyleSheet, useColorScheme, type ImageSourcePropType } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useGate } from "@/hooks/useGate";
import { takePendingJoinCode } from "@/lib/leagueInvite";
import { startQuietNotifications } from "@/lib/notifications";
import { takePendingInvite } from "@/lib/recording/pendingInvite";
import { useUploadRunner } from "@/lib/recording/uploader";

// The five tabs, in order, with Ball Boi in the center (spec: Navigation).
// Labels are the words used everywhere else in the app for these places.
// Messages isn't a tab: it opens from the button in the top corner of every tab.
const TABS: {
  name: string;
  label: string;
  symbol: SFSymbol;
  selected: SFSymbol;
  feather: React.ComponentProps<typeof Feather>["name"];
  /** A full-color image instead of an SF Symbol. */
  image?: ImageSourcePropType;
}[] = [
  { name: "index", label: "Home", symbol: "house", selected: "house.fill", feather: "home" },
  { name: "leagues", label: "Leagues", symbol: "trophy", selected: "trophy.fill", feather: "award" },
  // The hand-painted ball from the logo and ballboi.tennis, in its own colors.
  {
    name: "ballboi",
    label: "Ball Boi",
    symbol: "tennisball",
    selected: "tennisball.fill",
    feather: "circle",
    image: require("@/assets/images/tab-ballboi.png"),
  },
  { name: "discover", label: "Discover", symbol: "safari", selected: "safari.fill", feather: "compass" },
  { name: "profile", label: "Profile", symbol: "person.crop.circle", selected: "person.crop.circle.fill", feather: "user" },
];

/** iOS 26+: the system Liquid Glass tab bar. */
function NativeTabLayout() {
  const c = useColors();
  return (
    <NativeTabs tintColor={c.ink}>
      {TABS.map((t) => (
        <NativeTabs.Trigger key={t.name} name={t.name}>
          {t.image ? (
            <NativeTabs.Trigger.Icon src={t.image} renderingMode="original" />
          ) : (
            <NativeTabs.Trigger.Icon sf={{ default: t.symbol, selected: t.selected }} />
          )}
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
              t.image ? (
                <Image source={t.image} style={{ width: 26, height: 26 }} accessibilityIgnoresInvertColors />
              ) : isIOS ? (
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

/**
 * Invite links opened before the person was in the app (signed out, or
 * stopped at the age check or onboarding) open here, once, the first time
 * the tabs show: league invites and Quick match invites alike (A9, D8).
 */
function useOpenPendingLinks(ready: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    void (async () => {
      const [league, match] = await Promise.all([takePendingJoinCode(), takePendingInvite()]);
      if (league) router.push({ pathname: "/join/[code]", params: { code: league } });
      if (match) router.push({ pathname: "/record/invite/[code]", params: { code: match } });
    })();
  }, [ready, router]);
}

/**
 * Match day reminders (Wave 2): once the player is in the app, ask iOS for
 * quiet notifications (no prompt) and keep this phone's push token current.
 * Once per launch and account.
 */
function useQuietNotifications(ready: boolean) {
  const { getToken, userId } = useAuth();
  useEffect(() => {
    if (!ready || !userId) return;
    void startQuietNotifications(getToken);
    // getToken changes identity between renders; the account is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, userId]);
}

export default function TabLayout() {
  // The root layout moves anyone who can't be here yet (app/_layout.tsx).
  const ready = useGate() === "app";
  useOpenPendingLinks(ready);
  useQuietNotifications(ready);
  // Ball Boi uploads: resume at launch, on foreground, and when Wi-Fi comes back.
  useUploadRunner();

  if (!ready) return null;

  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
