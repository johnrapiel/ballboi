import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs, useRouter } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import React, { useEffect } from "react";
<<<<<<< HEAD
import { Image, Platform, StyleSheet, useColorScheme, View, type ImageSourcePropType } from "react-native";

import { MilestoneMoment } from "@/components/MilestoneMoment";
import { useColors } from "@/hooks/useColors";
=======
import { Image, Platform, StyleSheet, type ImageSourcePropType } from "react-native";

import { useColors, useScheme } from "@/hooks/useColors";
>>>>>>> wave2/h4-career
import { useGate } from "@/hooks/useGate";
import { usePushSetup } from "@/hooks/useNotificationAccess";
import { takePendingJoinCode } from "@/lib/leagueInvite";
import { takePendingInvite } from "@/lib/recording/pendingInvite";
import { useUploadRunner } from "@/lib/recording/uploader";

// The five tabs, in order, with Ball Boi in the center (spec: Navigation).
// Labels are the words used everywhere else in the app for these places.
// Messages isn't a tab: it opens from the button in the top corner of every tab.
//
// Icons are the custom brush set (John, Nov 5): muted ink line drawings, and
// the selected tab filled with the painted ball's own paint. They're drawn
// in their own colors for Day and Night, so the system never tints them; the
// label's weight and the system's selected state carry "selected" for
// VoiceOver. Source SVGs live in docs/design-system/icons and the PNGs come
// from scripts/design/tab-icons.py. Ball Boi keeps the logo ball, drawn
// the same way: muted when unselected, painted when selected.
type TabIcons = { off: ImageSourcePropType; on: ImageSourcePropType };
const TABS: {
  name: string;
  label: string;
  day: TabIcons;
  night: TabIcons;
}[] = [
  {
    name: "index",
    label: "Home",
    day: { off: require("@/assets/images/tabs/tab-home.png"), on: require("@/assets/images/tabs/tab-home-on.png") },
    night: { off: require("@/assets/images/tabs/tab-home-dark.png"), on: require("@/assets/images/tabs/tab-home-on-dark.png") },
  },
  {
    name: "leagues",
    label: "Leagues",
    day: { off: require("@/assets/images/tabs/tab-leagues.png"), on: require("@/assets/images/tabs/tab-leagues-on.png") },
    night: {
      off: require("@/assets/images/tabs/tab-leagues-dark.png"),
      on: require("@/assets/images/tabs/tab-leagues-on-dark.png"),
    },
  },
  // The logo ball, by the same rule as the others (finding 13): muted ink
  // strokes when unselected, filled with its paint only when selected.
  {
    name: "ballboi",
    label: "Ball Boi",
    day: { off: require("@/assets/images/tabs/tab-ballboi.png"), on: require("@/assets/images/tabs/tab-ballboi-on.png") },
    night: {
      off: require("@/assets/images/tabs/tab-ballboi-dark.png"),
      on: require("@/assets/images/tabs/tab-ballboi-on-dark.png"),
    },
  },
  {
    name: "discover",
    label: "Discover",
    day: { off: require("@/assets/images/tabs/tab-discover.png"), on: require("@/assets/images/tabs/tab-discover-on.png") },
    night: {
      off: require("@/assets/images/tabs/tab-discover-dark.png"),
      on: require("@/assets/images/tabs/tab-discover-on-dark.png"),
    },
  },
  {
    name: "profile",
    label: "Profile",
    day: { off: require("@/assets/images/tabs/tab-profile.png"), on: require("@/assets/images/tabs/tab-profile-on.png") },
    night: {
      off: require("@/assets/images/tabs/tab-profile-dark.png"),
      on: require("@/assets/images/tabs/tab-profile-on-dark.png"),
    },
  },
];

/** iOS 26+: the system Liquid Glass tab bar. */
function NativeTabLayout() {
  const c = useColors();
  const night = useScheme() === "dark";
  return (
    <NativeTabs tintColor={c.ink}>
      {TABS.map((t) => {
        const icons = night ? t.night : t.day;
        return (
          <NativeTabs.Trigger key={t.name} name={t.name}>
            <NativeTabs.Trigger.Icon src={{ default: icons.off, selected: icons.on }} renderingMode="original" />
            <NativeTabs.Trigger.Label>{t.label}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        );
      })}
    </NativeTabs>
  );
}

/** Older iOS: a standard blurred tab bar with the same tabs and icons. */
function ClassicTabLayout() {
  const c = useColors();
  const isDark = useScheme() === "dark";
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
      {TABS.map((t) => {
        const icons = isDark ? t.night : t.day;
        return (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: t.label,
              tabBarAccessibilityLabel: t.label,
              tabBarIcon: ({ focused }) => (
                <Image source={focused ? icons.on : icons.off} style={{ width: 26, height: 26 }} accessibilityIgnoresInvertColors />
              ),
            }}
          />
        );
      })}
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

export default function TabLayout() {
  // The root layout moves anyone who can't be here yet (app/_layout.tsx).
  const ready = useGate() === "app";
  useOpenPendingLinks(ready);
  // Quiet notifications from sign-in, the push token, and taps on pushes (Session G).
  usePushSetup(ready);
  // Ball Boi uploads: resume at launch, on foreground, and when Wi-Fi comes back.
  useUploadRunner();

  if (!ready) return null;

  // The milestone moment plays over the tabs, never blocking them (decision 149).
  return (
    <View style={{ flex: 1 }}>
      {isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />}
      <MilestoneMoment ready={ready} />
    </View>
  );
}
