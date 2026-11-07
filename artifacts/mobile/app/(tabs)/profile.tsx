import { useAuth, useUser } from "@clerk/expo";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import Constants from "expo-constants";
import { ActivityIndicator, Alert, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { IconButton } from "@/components/Choice";
import { RatingBadge } from "@/components/RatingBadge";
import { Roundel } from "@/components/Roundel";
import { SettingsRow, SettingsSection } from "@/components/SettingsList";
import { TabScreen } from "@/components/TabHeader";
import { Toggle } from "@/components/Toggle";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useDiscoverMe } from "@/hooks/useDiscover";
import { useProfile } from "@/hooks/useProfile";
import { useStableGetToken } from "@/hooks/useStableGetToken";
import { confirmSignOut } from "@/lib/confirmSignOut";
import { formatRating, levelSpoken, type RatingSource } from "@/lib/onboarding";
import { photoUrl } from "@/lib/photos";

// Profile tab (approved canvas: Profile, John, Nov 6). Your player card, your
// player details as rows that open the matching edit screen, Account (Sign out)
// above About (finding 19). Settings is the cog in the header, beside Messages
// (finding 30). Blocked players is gone: block lives in Report (finding 20). Delete account is at the bottom of Settings (finding 21).

function levelValue(rating: number | null | undefined, source: RatingSource | null | undefined): string {
  if (rating == null) return "Not set";
  return source === "verified" ? `${formatRating(rating)}, Verified` : formatRating(rating);
}

/**
 * Wave 1 review S8: the "Match day reminders" switch stays hidden until Wave 2
 * (Session G), which asks for notifications with a reason first (spec decision
 * 11). Turning it on fired the iOS notification prompt with no lead-in, and a
 * declined prompt can't be asked again. The code stays for Wave 2.
 */
const SHOW_MATCH_DAY_REMINDERS = false;

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

async function fetchWithAuth(
  path: string,
  options: RequestInit = {},
  getToken: () => Promise<string | null>
): Promise<Response> {
  const token = await getToken();
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const getToken = useStableGetToken();
  const { user } = useUser();
  const router = useRouter();
  // A1: the header shows the saved profile (name, photo, level), reloaded each
  // time the tab comes into focus, so an Edit profile save shows right away.
  const { profile } = useProfile();

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);

  const loadPushStatus = useCallback(async () => {
    if (Platform.OS === "web") return;
    try {
      const res = await fetchWithAuth("/api/notifications/expo-token/status", {}, getToken);
      if (res.ok) {
        const data = (await res.json()) as { registered: boolean };
        setPushEnabled(data.registered);
      }
    } catch {
    }
  }, [getToken]);

  useEffect(() => {
    if (SHOW_MATCH_DAY_REMINDERS) loadPushStatus();
  }, [loadPushStatus]);

  const registerPushToken = useCallback(async (): Promise<string | null> => {
    if (Platform.OS === "web") return null;

    // expo-notifications v56 PermissionResponse type may not resolve correctly in this TS config
    const existing = (await Notifications.getPermissionsAsync()) as { granted: boolean };
    let granted = existing.granted;

    if (!granted) {
      const result = (await Notifications.requestPermissionsAsync()) as { granted: boolean };
      granted = result.granted;
    }

    if (!granted) {
      Alert.alert(
        "Notifications Disabled",
        "Enable notifications in Settings to receive match day reminders.",
        [{ text: "OK" }]
      );
      return null;
    }

    try {
      const tokenData = await Notifications.getExpoPushTokenAsync();
      return tokenData.data;
    } catch {
      return null;
    }
  }, []);

  const handlePushToggle = useCallback(async (enabled: boolean) => {
    if (Platform.OS === "web") return;
    setPushLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      if (enabled) {
        const token = await registerPushToken();
        if (!token) {
          setPushLoading(false);
          return;
        }

        const res = await fetchWithAuth(
          "/api/notifications/expo-token",
          {
            method: "POST",
            body: JSON.stringify({ token }),
          },
          getToken
        );

        if (res.ok) {
          setPushToken(token);
          setPushEnabled(true);
        }
      } else {
        const tokenToRemove = pushToken ?? (await (async () => {
          try {
            const d = await Notifications.getExpoPushTokenAsync();
            return d.data;
          } catch {
            return null;
          }
        })());

        if (tokenToRemove) {
          await fetchWithAuth(
            "/api/notifications/expo-token",
            {
              method: "DELETE",
              body: JSON.stringify({ token: tokenToRemove }),
            },
            getToken
          );
        }

        setPushToken(null);
        setPushEnabled(false);
      }
    } catch {
      Alert.alert("Error", "Could not update notification settings. Please try again.");
    } finally {
      setPushLoading(false);
    }
  }, [getToken, pushToken, registerPushToken]);

  const handleSignOut = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!(await confirmSignOut(signOut))) return;
    router.replace("/(auth)/welcome");
  };

  // Until the profile loads, the Clerk name (never part of the email).
  const displayName = profile?.displayName?.trim() || user?.fullName?.trim() || "";

  return (
    <TabScreen
      title="Profile"
      action={(
        <IconButton
          symbol="gearshape"
          label="Settings"
          hint="Ball Boi recording settings, and Delete account"
          onPress={() => router.push("/settings")}
        />
      )}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: spacing.space4, paddingTop: spacing.space2, paddingBottom: bottomPad + 96, gap: spacing.space6 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Your player card: avatar left, name and level beside it (approved canvas). */}
        <View
          accessible
          accessibilityLabel={[displayName, profile?.rating != null ? levelSpoken(profile.rating, profile.ratingSource ?? "self") : null].filter(Boolean).join(", ")}
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.space4 }}
        >
          <Avatar name={displayName} uri={photoUrl(profile?.avatarUrl)} size={72} />
          <View style={{ flex: 1, gap: spacing.space2 }}>
            <Text variant="title">{displayName}</Text>
            {profile?.rating != null ? <RatingBadge rating={profile.rating} source={profile.ratingSource ?? "self"} /> : null}
          </View>
        </View>

        <SettingsSection title="Player details" footer="Your name, photo and level show on your player card. Your home area is never shown, only an approximate distance.">
          <SettingsRow
            title="Name and photo"
            value={displayName || null}
            onPress={() => router.push("/profile/edit/name")}
            accessibilityHint="Change your name and photo"
          />
          <SettingsRow
            title="Level"
            value={profile ? levelValue(profile.rating, profile.ratingSource) : null}
            onPress={() => router.push("/profile/edit/level")}
            accessibilityHint="Change your self-rated level"
          />
          <SettingsRow
            title="Home area"
            value={profile ? profile.homeZip ?? "Not set" : null}
            onPress={() => router.push("/profile/edit/home")}
            accessibilityHint="Change your home area"
          />
          <WhenIPlayRow />
        </SettingsSection>

        {SHOW_MATCH_DAY_REMINDERS && Platform.OS !== "web" ? (
          <SettingsSection title="Notifications">
            <SettingsRow
              title="Match day reminders"
              subtitle="A heads-up before each match"
              trailing={
                pushLoading ? (
                  <ActivityIndicator size="small" color={colors.ink} />
                ) : (
                  <Toggle value={pushEnabled} onValueChange={handlePushToggle} accessibilityLabel="Match day reminders" />
                )
              }
              last
            />
          </SettingsSection>
        ) : null}

        {/* Account sits above About (John, Nov 6, finding 19). */}
        <View style={{ gap: spacing.space2 }}>
          <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ paddingHorizontal: spacing.space1 }}>
            Account
          </Text>
          <Button label="Sign out" variant="destructiveOutline" onPress={handleSignOut} />
        </View>

        <View style={{ alignItems: "center", gap: spacing.space2, paddingTop: spacing.space2 }}>
          <Text variant="section" tone="inkMuted" accessibilityRole="header">
            About
          </Text>
          <Roundel size={56} />
          <Text variant="small" tone="inkMuted">
            {`Ball Boi ${Constants.expoConfig?.version ?? "1.0"}`}
          </Text>
        </View>
      </ScrollView>
    </TabScreen>
  );
}

/** Profile › When I play (Discover, F7, F8): what you play and when you're free. */
function WhenIPlayRow() {
  const router = useRouter();
  const me = useDiscoverMe();
  return (
    <SettingsRow
      title="When I play"
      subtitle={me.data ? me.data.freeSummary ?? "Add when you can play" : null}
      onPress={() => router.push("/discover/play")}
      accessibilityHint="Singles or doubles, and the hours you're usually free"
      last
    />
  );
}
