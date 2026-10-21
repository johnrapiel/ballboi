import { useAuth, useUser } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TabScreen } from "@/components/TabHeader";
import { useColors } from "@/hooks/useColors";

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
  const { signOut, getToken } = useAuth();
  const { user } = useUser();
  const router = useRouter();

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
    loadPushStatus();
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
    await signOut();
    router.replace("/(auth)/welcome");
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: bottomPad + 96,
    },
    avatarRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      marginBottom: 32,
    },
    avatar: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontSize: 28,
      fontWeight: "700" as const,
      color: colors.primaryForeground,
      fontFamily: "DMSans_700Bold",
    },
    userInfo: {
      flex: 1,
    },
    userName: {
      fontSize: 18,
      fontWeight: "700" as const,
      color: colors.foreground,
      fontFamily: "DMSans_700Bold",
    },
    userEmail: {
      fontSize: 14,
      color: colors.mutedForeground,
      marginTop: 4,
      fontFamily: "DMSans_400Regular",
    },
    section: {
      marginBottom: 24,
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: colors.mutedForeground,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      marginBottom: 12,
      fontFamily: "DMSans_600SemiBold",
    },
    card: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius + 2,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      padding: 16,
      gap: 14,
    },
    rowBorder: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    rowIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    rowText: {
      flex: 1,
      fontSize: 15,
      color: colors.foreground,
      fontFamily: "DMSans_500Medium",
    },
    rowSubtext: {
      fontSize: 13,
      color: colors.mutedForeground,
      fontFamily: "DMSans_400Regular",
    },
    signOutBtn: {
      backgroundColor: colors.destructive + "22",
      borderWidth: 1,
      borderColor: colors.destructive + "44",
      borderRadius: colors.radius + 2,
      padding: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      marginTop: 8,
    },
    signOutText: {
      fontSize: 15,
      fontWeight: "600" as const,
      color: colors.destructive,
      fontFamily: "DMSans_600SemiBold",
    },
  });

  const initials = user?.firstName
    ? `${user.firstName[0]}${user.lastName ? user.lastName[0] : ""}`.toUpperCase()
    : user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? "?";

  const fullName = user?.firstName
    ? [user.firstName, user.lastName].filter(Boolean).join(" ")
    : "Player";

  return (
    <TabScreen title="Profile">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{fullName}</Text>
            <Text style={styles.userEmail}>
              {user?.emailAddresses?.[0]?.emailAddress ?? ""}
            </Text>
          </View>
        </View>

        {Platform.OS !== "web" && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notifications</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={[styles.rowIconWrap, { backgroundColor: colors.primary + "22" }]}>
                  <Ionicons name="notifications" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowText}>Match day reminders</Text>
                  <Text style={styles.rowSubtext}>
                    Push notification the day before your match
                  </Text>
                </View>
                {pushLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Switch
                    value={pushEnabled}
                    onValueChange={handlePushToggle}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.primaryForeground}
                  />
                )}
              </View>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>About</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={[styles.rowIconWrap, { backgroundColor: colors.primary + "22" }]}>
                <Ionicons name="tennisball" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowText}>Ball Boi Mobile</Text>
                <Text style={styles.rowSubtext}>Match replay companion</Text>
              </View>
            </View>
            <View style={[styles.row, styles.rowBorder]}>
              <View style={[styles.rowIconWrap, { backgroundColor: colors.muted }]}>
                <Ionicons name="information-circle" size={18} color={colors.mutedForeground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowText}>Version</Text>
                <Text style={styles.rowSubtext}>1.0.0</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <Pressable
            style={({ pressed }) => [styles.signOutBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={handleSignOut}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.destructive} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </TabScreen>
  );
}
